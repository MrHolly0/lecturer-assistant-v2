package ru.university.assistant.content.internal;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.transaction.support.TransactionTemplate;
import ru.university.assistant.content.api.ImportJobStatus;
import ru.university.assistant.shared.api.UuidV7;

@Component
class SlideImportWorker {
    private final ContentRepository repository;
    private final SlideConversionClient converter;
    private final TransactionTemplate transactionTemplate;
    private final int maxAttempts;

    SlideImportWorker(
            ContentRepository repository,
            SlideConversionClient converter,
            TransactionTemplate transactionTemplate,
            @Value("${app.content.import-max-attempts:3}") int maxAttempts) {
        this.repository = repository;
        this.converter = converter;
        this.transactionTemplate = transactionTemplate;
        this.maxAttempts = Math.max(1, maxAttempts);
    }

    public void process(ContentRepository.ImportClaim claim) {
        UUID jobId = claim.id();
        UUID courseId = claim.courseId();
        AtomicInteger processed = new AtomicInteger();
        AtomicInteger total = new AtomicInteger();
        AtomicReference<String> warning = new AtomicReference<>();
        UUID deckId = null;
        try {
            var persisted = repository.findJob(courseId, jobId).orElseThrow();
            processed.set(persisted.processedSlides());
            total.set(persisted.totalSlides() == null ? 0 : persisted.totalSlides());
            warning.set(persisted.warningMessage());
            StoredBlob source = repository.findJobSource(jobId)
                    .orElseThrow(() -> new IllegalStateException("Import source is missing"));
            deckId = transactionTemplate.execute(status -> createOrReuseDeck(claim, source));
            mark(claim, ImportJobStatus.RUNNING, progress(processed.get(), total.get()), "CONVERTING_PDF",
                    processed.get(), total.get() == 0 ? null : total.get(), null, warning.get(), deckId);
            UUID currentDeckId = deckId;
            SlideConversionResult result = converter.convert(
                    source,
                    "decks/" + jobId + "/" + claim.token(),
                    claim.token(),
                    new SlideConversionSink() {
                @Override
                public void metadata(int totalSlides, int renderedSlides, String phase, String warningMessage) {
                    total.set(totalSlides);
                    warning.set(firstNonBlank(warning.get(), warningMessage));
                    mark(claim, ImportJobStatus.RUNNING, progress(processed.get(), renderedSlides), phase,
                            processed.get(), totalSlides,
                            null, warning.get(), currentDeckId);
                }

                @Override
                public void slide(ConvertedSlide slide, int processedSlides, int totalSlides) {
                    processed.accumulateAndGet(processedSlides, Math::max);
                    total.set(totalSlides);
                    transactionTemplate.executeWithoutResult(status -> {
                        repository.requireClaim(claim);
                        repository.addSlide(UuidV7.generate(), currentDeckId, slide);
                    });
                    mark(claim, ImportJobStatus.RUNNING, progress(processedSlides, totalSlides),
                            "RENDERING " + processedSlides + "/" + totalSlides,
                            processedSlides, totalSlides, null, warning.get(), currentDeckId);
                }
            });
            warning.set(firstNonBlank(warning.get(), result.warningMessage()));
            int validatedSlides = Math.max(processed.get(), result.renderedSlides());
            boolean hasError = result.errorMessage() != null && !result.errorMessage().isBlank();
            ImportJobStatus finalStatus = hasError
                    ? (validatedSlides > 0 ? ImportJobStatus.PARTIAL : ImportJobStatus.FAILED)
                    : result.partial() ? ImportJobStatus.PARTIAL : ImportJobStatus.COMPLETED;
            int finalProgress = finalStatus == ImportJobStatus.COMPLETED
                    ? 100 : progress(validatedSlides, result.totalSlides());
            mark(claim, finalStatus, finalProgress, finalStatus.name(), validatedSlides, result.totalSlides(),
                    result.errorMessage(), warning.get(), deckId);
        } catch (RetryableImportException exception) {
            int attempts = repository.attempts(claim);
            int jitter = ThreadLocalRandom.current().nextInt(1, Math.min(300, 1 << Math.min(8, attempts)) + 1);
            if (!repository.retryClaim(claim, Math.max(jitter, exception.retryAfterSeconds()), maxAttempts)) {
                mark(claim, processed.get() > 0 ? ImportJobStatus.PARTIAL : ImportJobStatus.FAILED,
                        processed.get() > 0 ? progress(processed.get(), total.get()) : 100,
                        "RETRY_EXHAUSTED", processed.get(), total.get() == 0 ? null : total.get(),
                        "Конвертер временно недоступен. Импорт можно повторить.", warning.get(), deckId);
            }
        } catch (ContentRepository.LostImportClaimException exception) {
            // A recovered worker owns the job now. Its progress and outcome must remain untouched.
        } catch (RuntimeException exception) {
            ImportJobStatus status = processed.get() > 0 ? ImportJobStatus.PARTIAL : ImportJobStatus.FAILED;
            mark(claim, status, processed.get() > 0 ? progress(processed.get(), total.get()) : 100,
                    status.name(), processed.get(), total.get() == 0 ? null : total.get(),
                    userMessage(exception), warning.get(), deckId);
        }
    }

    private UUID createOrReuseDeck(ContentRepository.ImportClaim claim, StoredBlob source) {
        repository.requireClaim(claim);
        UUID jobId = claim.id();
        UUID courseId = claim.courseId();
        String title = claim.title();
        return repository.findDeckIdByJobId(jobId)
                .orElseGet(() -> {
                    int version = repository.nextDeckVersion(courseId, title);
                    UUID deckId = UuidV7.generate();
                    repository.createDeck(deckId, courseId, title, version, source, jobId);
                    return deckId;
                });
    }

    private void mark(
            ContentRepository.ImportClaim claim,
            ImportJobStatus status,
            int progress,
            String phase,
            int processedSlides,
            Integer totalSlides,
            String errorMessage,
            String warningMessage,
            UUID deckId) {
        if (!repository.markJob(claim.id(), status, progress, phase, processedSlides, totalSlides,
                errorMessage, warningMessage, deckId, claim.token())) {
            throw new ContentRepository.LostImportClaimException();
        }
    }

    private int progress(int processedSlides, int totalSlides) {
        if (totalSlides <= 0) {
            return 5;
        }
        return Math.min(99, Math.max(5, (int) Math.round((processedSlides * 100.0) / totalSlides)));
    }

    private String userMessage(RuntimeException exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? "Импорт презентации завершился ошибкой" : message;
    }

    private String firstNonBlank(String current, String next) {
        if (next == null || next.isBlank()) return current;
        if (current == null || current.isBlank()) return next;
        if (current.contains(next)) return current;
        String combined = next.contains(current) ? next : current + " " + next;
        return combined.substring(0, Math.min(16384, combined.length()));
    }
}
