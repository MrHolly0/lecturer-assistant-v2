package ru.university.assistant.content.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import ru.university.assistant.content.api.ImportJob;
import ru.university.assistant.content.api.ImportJobStatus;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.org.api.CourseAccessApi;

class ContentImportCommitTest {
    @Test
    void startsWorkerOnlyAfterImportJobCommit() throws Exception {
        CourseAccessApi access = mock(CourseAccessApi.class);
        ContentRepository repository = mock(ContentRepository.class);
        BlobStorage storage = mock(BlobStorage.class);
        SlideImportWorker worker = mock(SlideImportWorker.class);
        ContentProperties properties = new ContentProperties(
                null, null, 1024, null, null, null, null, 0, 0, 0);
        ContentService service = new ContentService(
                access, repository, storage, worker, properties, mock(SignedSlideUrlService.class));
        UUID courseId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        ImportJob job = new ImportJob(jobId, courseId, null, ImportJobStatus.PENDING,
                0, null, 0, null, "deck.pdf", null, null, null, null);
        StoredBlob source = new StoredBlob("test/source", "deck.pdf", "application/pdf", 9);
        when(storage.store(any(), any(), any(), anyLong())).thenReturn(source);
        when(repository.createJob(any(UUID.class), eq(courseId), eq(source))).thenReturn(job);
        MockMultipartFile file = new MockMultipartFile("file", "deck.pdf", "application/pdf",
                "%PDF-test".getBytes(StandardCharsets.US_ASCII));
        AuthenticatedUser teacher = new AuthenticatedUser(
                UUID.randomUUID(), "Teacher", "teacher@example.invalid", PersonRole.LECTURER);

        TransactionSynchronizationManager.initSynchronization();
        try {
            assertEquals(job, service.startDeckImport(teacher, courseId, "Load deck", file));
            verify(worker, never()).process(any(), any(), any());
            for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
                synchronization.afterCommit();
            }
            verify(worker).process(jobId, courseId, "Load deck");
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }
}
