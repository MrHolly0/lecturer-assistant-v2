package ru.university.assistant.channel.internal;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.shared.api.ScreenFrameLimits;

/** Short-lived, adapter-only files requested by a participant; never a screenshot history. */
@Service
public class ChannelMediaStore {
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final Duration COOLDOWN = Duration.ofSeconds(10);
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final int MAX_FILES = 1024;
    private static final int MAX_FILE_BYTES = ScreenFrameLimits.MAX_BYTES;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final DateTimeFormatter FILE_TIME =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private final Map<String, Item> files = new HashMap<>();
    private final Map<FrameKey, String> frames = new HashMap<>();
    private final Map<UUID, Instant> lastSent = new HashMap<>();
    private final ChannelRepository channels;
    private final Clock clock;
    private int storedBytes;

    ChannelMediaStore(ChannelRepository channels, Clock clock) {
        this.channels = channels;
        this.clock = clock;
    }

    synchronized Staged stage(UUID personId, UUID identityId, UUID shareId, Instant receivedAt, byte[] jpeg) {
        purgeExpired();
        FrameKey key = new FrameKey(personId, shareId, receivedAt);
        String existing = frames.get(key);
        if (existing != null) return staged(existing, files.get(existing));
        Instant now = clock.instant();
        if (lastSent.containsKey(personId) && lastSent.get(personId).plus(COOLDOWN).isAfter(now)) {
            throw error(HttpStatus.TOO_MANY_REQUESTS, "Следующий кадр можно запросить через 10 секунд");
        }
        if (jpeg == null || jpeg.length == 0 || jpeg.length > MAX_FILE_BYTES) {
            throw error(HttpStatus.BAD_REQUEST, "Недопустимый размер кадра");
        }
        if (receivedAt.isAfter(now)) throw error(HttpStatus.CONFLICT, "Время кадра ещё не наступило");
        if (files.size() >= MAX_FILES || storedBytes + jpeg.length > MAX_BYTES) {
            throw error(HttpStatus.TOO_MANY_REQUESTS, "Очередь кадров заполнена. Повторите позже");
        }
        byte[] secret = new byte[32];
        RANDOM.nextBytes(secret);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        Item item = new Item(key, identityId, jpeg.clone(), now.plus(TTL),
                "demonstration-" + FILE_TIME.format(receivedAt) + ".jpg");
        files.put(token, item);
        frames.put(key, token);
        lastSent.put(personId, now);
        storedBytes += jpeg.length;
        return staged(token, item);
    }

    public synchronized MediaFile file(String token) {
        purgeExpired();
        Item item = files.get(token);
        if (item == null) throw error(HttpStatus.GONE, "Запрошенный кадр больше недоступен");
        if (!channels.isActiveMaxIdentity(item.key().personId(), item.identityId())) {
            remove(token, item);
            throw error(HttpStatus.GONE, "Привязка MAX больше недоступна");
        }
        return new MediaFile(item.bytes().clone(), item.filename());
    }

    @Scheduled(fixedDelay = 60000)
    public synchronized void purgeExpired() {
        Instant now = clock.instant();
        Iterator<Map.Entry<String, Item>> iterator = files.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, Item> entry = iterator.next();
            if (!entry.getValue().expiresAt().isAfter(now)) {
                storedBytes -= entry.getValue().bytes().length;
                frames.remove(entry.getValue().key());
                iterator.remove();
            }
        }
        lastSent.entrySet().removeIf(entry -> !entry.getValue().plus(COOLDOWN).isAfter(now));
    }

    private Staged staged(String token, Item item) {
        FrameKey key = item.key();
        UUID deliveryId = UUID.nameUUIDFromBytes((key.personId() + ":" + key.shareId() + ":" + key.receivedAt())
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new Staged(deliveryId, "/internal/v1/channels/max/media/" + token);
    }

    private void remove(String token, Item item) {
        files.remove(token);
        frames.remove(item.key());
        storedBytes -= item.bytes().length;
    }

    private static ResponseStatusException error(HttpStatus status, String message) {
        return new ResponseStatusException(status, message);
    }

    private record FrameKey(UUID personId, UUID shareId, Instant receivedAt) {}
    private record Item(FrameKey key, UUID identityId, byte[] bytes, Instant expiresAt, String filename) {}
    record Staged(UUID deliveryId, String ref) {}
    public record MediaFile(byte[] bytes, String filename) {}
}
