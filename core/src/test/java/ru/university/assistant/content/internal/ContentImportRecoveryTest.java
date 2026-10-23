package ru.university.assistant.content.internal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class ContentImportRecoveryTest {
    @Test
    void disabledApiProcessNeverClaimsOrRecoversAnotherWorkersJobs() {
        var repository = mock(ContentRepository.class);
        var executor = new ThreadPoolTaskExecutor();
        var recovery = new ContentImportRecovery(repository, mock(SlideImportWorker.class), executor, false, 90, 3);
        recovery.dispatch();
        verify(repository, never()).claimJob(any(), anyInt());
        verify(repository, never()).recoverExpiredJobs(anyInt());
    }

    @Test
    void dispatcherClaimsOnlyItsWorkerCapacityAndHeartbeatsWhileConversionBlocks() throws Exception {
        var repository = mock(ContentRepository.class);
        var worker = mock(SlideImportWorker.class);
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(1);
        executor.initialize();
        var claim = new ContentRepository.ImportClaim(UUID.randomUUID(), UUID.randomUUID(), "Test", UUID.randomUUID());
        when(repository.claimJob(any(), anyInt())).thenReturn(Optional.of(claim), Optional.empty());
        CountDownLatch processing = new CountDownLatch(1);
        CountDownLatch finish = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            processing.countDown();
            finish.await(5, TimeUnit.SECONDS);
            return null;
        }).when(worker).process(claim);
        var recovery = new ContentImportRecovery(repository, worker, executor, true, 90, 3);
        try {
            recovery.dispatch();
            if (!processing.await(5, TimeUnit.SECONDS)) throw new AssertionError("Worker did not start");
            recovery.dispatch();
            verify(repository).claimJob(any(), anyInt());
            recovery.heartbeat();
            verify(repository).heartbeat(claim, 90);
        } finally {
            finish.countDown();
            executor.shutdown();
        }
    }
}
