package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.SessionLimitExceededException;
import ru.university.assistant.iam.api.TokenAuthenticationApi;
import ru.university.assistant.org.api.CourseAccessApi;

class LiveWebSocketBudgetTest {
    private final LiveWebSocketConfig config = new LiveWebSocketConfig(
            mock(TokenAuthenticationApi.class), mock(LiveSessionRepository.class), mock(CourseAccessApi.class),
            "http://localhost");

    @Test
    void bothChannelsRejectExcessWorkAndRecoverAfterSlowConsumersDrain() throws Exception {
        for (boolean inbound : new boolean[] {true, false}) {
            TestChannelRegistration registration = new TestChannelRegistration();
            if (inbound) config.configureClientInboundChannel(registration);
            else config.configureClientOutboundChannel(registration);
            ThreadPoolTaskExecutor executor = registration.initialize();
            CountDownLatch release = new CountDownLatch(1);
            CountDownLatch started = new CountDownLatch(4);
            Runnable blocked = () -> {
                started.countDown();
                try { release.await(5, TimeUnit.SECONDS); }
                catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
            };
            try {
                for (int i = 0; i < 260; i++) executor.execute(blocked);
                assertTrue(started.await(2, TimeUnit.SECONDS));
                assertThrows(TaskRejectedException.class, () -> executor.execute(blocked));
                assertEquals(256, executor.getThreadPoolExecutor().getQueue().size());
                release.countDown();
                CountDownLatch recovered = new CountDownLatch(1);
                // A just-released worker may not have dequeued a slot yet.
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
                while (executor.getThreadPoolExecutor().getQueue().size() == 256
                        && System.nanoTime() < deadline) Thread.onSpinWait();
                executor.execute(recovered::countDown);
                assertTrue(recovered.await(2, TimeUnit.SECONDS));
            } finally {
                release.countDown();
                executor.shutdown();
            }
        }
    }

    @Test
    void stalledSocketCannotAccumulateAnUnboundedSendBuffer() throws Exception {
        TestTransportRegistration registration = new TestTransportRegistration();
        config.configureWebSocketTransport(registration);
        WebSocketSession transport = mock(WebSocketSession.class);
        when(transport.getId()).thenReturn("slow-teacher");
        when(transport.isOpen()).thenReturn(true);
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            writing.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return null;
        }).when(transport).sendMessage(any());
        ConcurrentWebSocketSessionDecorator session = new ConcurrentWebSocketSessionDecorator(
                transport, registration.sendTimeLimit(), registration.sendBufferLimit());
        AtomicReference<Throwable> backgroundFailure = new AtomicReference<>();
        Thread first = new Thread(() -> {
            try { session.sendMessage(new TextMessage("first")); }
            catch (Throwable exception) { backgroundFailure.set(exception); }
        });
        first.start();
        try {
            assertTrue(writing.await(2, TimeUnit.SECONDS));
            assertThrows(SessionLimitExceededException.class,
                    () -> session.sendMessage(new TextMessage("x".repeat(registration.sendBufferLimit() + 1))));
        } finally {
            release.countDown();
            first.join(3000);
        }
        assertTrue(!first.isAlive());
        assertEquals(null, backgroundFailure.get());
    }

    private static final class TestChannelRegistration extends ChannelRegistration {
        ThreadPoolTaskExecutor initialize() {
            return (ThreadPoolTaskExecutor) getExecutor(
                    () -> { throw new AssertionError("No configured executor"); },
                    executor -> ((ThreadPoolTaskExecutor) executor).initialize());
        }
    }

    private static final class TestTransportRegistration extends WebSocketTransportRegistration {
        int sendBufferLimit() { return getSendBufferSizeLimit(); }
        int sendTimeLimit() { return getSendTimeLimit(); }
    }
}
