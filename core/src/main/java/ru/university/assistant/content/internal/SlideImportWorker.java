package ru.university.assistant.content.internal;

import java.util.List;
import java.util.UUID;
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

    @Async
    public void process(UUID jobId, UUID courseId, String title) {
        try {
            repository.markJob(jobId, ImportJobStatus.RUNNING, 10, null, null);
            StoredBlob source = repository.findJobSource(jobId)
                    .orElseThrow(() -> new IllegalStateException("Import source is missing"));
            List<ConvertedSlide> slides = converter.convert(source, "decks/" + jobId);
            repository.markJob(jobId, ImportJobStatus.RUNNING, 85, null, null);
            UUID deckId = transactionTemplate.execute(status -> persistDeck(jobId, courseId, title, source, slides));
            repository.markJob(jobId, ImportJobStatus.COMPLETED, 100, null, deckId);
        } catch (RuntimeException exception) {
            repository.markJob(jobId, ImportJobStatus.FAILED, 100, exception.getMessage(), null);
        }
    }

    private UUID persistDeck(UUID jobId, UUID courseId, String title, StoredBlob source, List<ConvertedSlide> slides) {
        int version = repository.nextDeckVersion(courseId, title);
        UUID deckId = UuidV7.generate();
        repository.createDeck(deckId, courseId, title, version, source, jobId);
        for (ConvertedSlide slide : slides) {
            repository.addSlide(UuidV7.generate(), deckId, slide);
        }
        return deckId;
    }
}
