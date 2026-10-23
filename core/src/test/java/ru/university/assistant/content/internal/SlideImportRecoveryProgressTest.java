package ru.university.assistant.content.internal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import ru.university.assistant.content.api.ImportJob;
import ru.university.assistant.content.api.ImportJobStatus;

class SlideImportRecoveryProgressTest {
    @Test
    void immediateFailureAfterRecoveryKeepsAlreadyValidatedSlidesAndPartialOutcome() {
        var repository = mock(ContentRepository.class);
        var converter = mock(SlideConversionClient.class);
        var transactions = mock(TransactionTemplate.class);
        UUID job = UUID.randomUUID();
        UUID course = UUID.randomUUID();
        UUID deck = UUID.randomUUID();
        var claim = new ContentRepository.ImportClaim(job, course, "Recovered", UUID.randomUUID());
        var source = new StoredBlob("source.pdf", "source.pdf", "application/pdf", 100);
        when(repository.findJob(course, job)).thenReturn(Optional.of(new ImportJob(job, course, deck,
                ImportJobStatus.RUNNING, 40, "QUEUED_RECOVERY", 2, 5, "source.pdf", null, null, null, null)));
        when(repository.findJobSource(job)).thenReturn(Optional.of(source));
        when(repository.findDeckIdByJobId(job)).thenReturn(Optional.of(deck));
        doAnswer(invocation -> ((TransactionCallback<?>) invocation.getArgument(0))
                .doInTransaction(mock(TransactionStatus.class))).when(transactions).execute(any());
        when(repository.markJob(any(), any(), anyInt(), any(), anyInt(), any(), any(), any(), any(), any()))
                .thenReturn(true);
        when(converter.convert(any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("Invalid converter frame"));
        new SlideImportWorker(repository, converter, transactions, 3).process(claim);
        verify(repository).markJob(eq(job), eq(ImportJobStatus.PARTIAL), anyInt(), eq("PARTIAL"),
                eq(2), eq(5), eq("Invalid converter frame"), any(), eq(deck), eq(claim.token()));
    }
}
