package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.time.Clock;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class PasswordAdmissionTest {
    @Test
    void saturatedPasswordWorkRejectsWithoutQueueAndReleasesAfterFailure() throws Exception {
        var gate = new PasswordAdmission(Clock.systemUTC(), 2, 30);
        var entered = new CountDownLatch(2);
        var release = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            for (int i = 0; i < 2; i++)
                pool.submit(
                        () ->
                                gate.check(
                                        "reader@example.test",
                                        () -> {
                                            entered.countDown();
                                            try {
                                                release.await();
                                            } catch (InterruptedException e) {
                                                Thread.currentThread().interrupt();
                                            }
                                            throw new IllegalStateException("invalid password");
                                        }));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            var rejected =
                    assertThrows(
                            org.springframework.web.server.ResponseStatusException.class,
                            () ->
                                    gate.check(
                                            "another@example.test",
                                            () -> {
                                                fail("must not start password verification");
                                                return true;
                                            }));
            assertEquals(429, rejected.getStatusCode().value());
            release.countDown();
            pool.shutdown();
            assertTrue(pool.awaitTermination(2, TimeUnit.SECONDS));
            assertTrue(gate.check("another@example.test", () -> true));
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }
}
