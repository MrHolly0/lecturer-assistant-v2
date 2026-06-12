package ru.university.assistant.content.internal;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import ru.university.assistant.content.api.ImportJobStatus;
import ru.university.assistant.shared.api.UuidV7;

@Component
class SlideImportWorker {
    private final ContentRepository repository;
    private final SlideConversionClient converter;
    private final TransactionTemplate transactionTemplate;

    SlideImportWorker(
            ContentRepository repository,
            SlideConversionClient converter,
            TransactionTemplate transactionTemplate) {
        this.repository = repository;
        this.converter = converter;
        this.transactionTemplate = transactionTemplate;
    }

    @Async("contentImportExecutor")
    public void process(UUID jobId, UUID courseId, String title) {
        AtomicInteger processed = new AtomicInteger();
        AtomicInteger total = new AtomicInteger();
        AtomicReference<String> warning = new AtomicReference<>();
        UUID deckId = null;
        try {
            StoredBlob source = repository.findJobSource(jobId)
                    .orElseThrow(() -> new IllegalStateException("Import source is missing"));
            deckId = transactionTemplate.execute(status -> createOrReuseDeck(jobId, courseId, title, source));
            mark(jobId, ImportJobStatus.RUNNING, 3, "CONVERTING_PDF", 0, null, null, null, deckId);
            UUID currentDeckId = deckId;
            SlideConversionResult result = converter.convert(
                    source,
                    "decks/" + jobId,
                    jobId,
                    new SlideConversionSink() {
                @Override
                public void metadata(int totalSlides, int renderedSlides, String phase, String warningMessage) {
                    total.set(totalSlides);
                    warning.set(firstNonBlank(warning.get(), warningMessage));
                    mark(jobId, ImportJobStatus.RUNNING, progress(0, renderedSlides), phase, 0, totalSlides,
                            null, warning.get(), currentDeckId);
                }

                @Override
                public void slide(ConvertedSlide slide, int processedSlides, int totalSlides) {
                    processed.set(processedSlides);
                    total.set(totalSlides);
                    transactionTemplate.executeWithoutResult(status ->
                            repository.addSlide(UuidV7.generate(), currentDeckId, slide));
                    mark(jobId, ImportJobStatus.RUNNING, progress(processedSlides, totalSlides),
                            "RENDERING " + processedSlides + "/" + totalSlides,
                            processedSlides, totalSlides, null, warning.get(), currentDeckId);
                }
            });
            warning.set(firstNonBlank(warning.get(), result.warningMessage()));
            ImportJobStatus finalStatus = result.partial() ? ImportJobStatus.PARTIAL : ImportJobStatus.COMPLETED;
            int finalProgress = result.partial() ? progress(result.renderedSlides(), result.totalSlides()) : 100;
            mark(jobId, finalStatus, finalProgress, finalStatus.name(), result.renderedSlides(), result.totalSlides(),
                    result.errorMessage(), warning.get(), deckId);
        } catch (RuntimeException exception) {
            ImportJobStatus status = processed.get() > 0 ? ImportJobStatus.PARTIAL : ImportJobStatus.FAILED;
            mark(jobId, status, processed.get() > 0 ? progress(processed.get(), total.get()) : 100,
                    status.name(), processed.get(), total.get() == 0 ? null : total.get(),
                    userMessage(exception), warning.get(), deckId);
        }
    }

    private UUID createOrReuseDeck(UUID jobId, UUID courseId, String title, StoredBlob source) {
        return repository.findDeckIdByJobId(jobId)
                .orElseGet(() -> {
                    int version = repository.nextDeckVersion(courseId, title);
                    UUID deckId = UuidV7.generate();
                    repository.createDeck(deckId, courseId, title, version, source, jobId);
                    return deckId;
                });
    }

    private void mark(
            UUID jobId,
            ImportJobStatus status,
            int progress,
            String phase,
            int processedSlides,
            Integer totalSlides,
            String errorMessage,
            String warningMessage,
            UUID deckId) {
        repository.markJob(jobId, status, progress, phase, processedSlides, totalSlides,
                errorMessage, warningMessage, deckId);
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
        if (current != null && !current.isBlank()) {
            return current;
        }
        return next == null || next.isBlank() ? current : next;
    }
}
