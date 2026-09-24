package ru.university.assistant.iam.internal.security;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/**
 * B-13: минимальный ограничитель частоты — не более {@code limit} обращений одного ключа
 * за скользящее {@code window}. В памяти процесса, без внешних зависимостей; для одного
 * инстанса на VPS этого достаточно. Ключи никогда не удаляются (растут вместе с числом
 * увиденных IP) — на масштабе пилота не проблема, при реальном росте нагрузки стоит заменить
 * на что-то вроде Caffeine с TTL.
 */
class SlidingWindowRateLimiter {
    private final int limit;
    private final Duration window;
    private final Clock clock;
    private final ConcurrentHashMap<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    SlidingWindowRateLimiter(int limit, Duration window, Clock clock) {
        this.limit = limit;
        this.window = window;
        this.clock = clock;
    }

    boolean tryAcquire(String key) {
        long now = clock.millis();
        long windowStart = now - window.toMillis();
        Deque<Long> deque = hits.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (deque) {
            while (!deque.isEmpty() && deque.peekFirst() < windowStart) {
                deque.pollFirst();
            }
            if (deque.size() >= limit) {
                return false;
            }
            deque.addLast(now);
            return true;
        }
    }
}
