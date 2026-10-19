package ru.university.assistant.projection.internal;

import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.live.api.SessionStateChanged;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.projection.api.ShareVideoMetadata;
import ru.university.assistant.projection.internal.ShareService.VideoScope;

/** Bounded, ephemeral encoded video ring. No recording, disk files, decoding or executable input. */
@Service
public class ShareVideoStore {
    public static final int MAX_INIT = 128 * 1024;
    public static final int MAX_SEGMENT = 2 * 1024 * 1024;
    static final int MAX_ROOM_BYTES = 8 * 1024 * 1024;
    static final int MAX_GLOBAL_BYTES = 64 * 1024 * 1024;
    private final ShareService shares;
    private final Clock clock;
    private final Map<UUID, VideoRoom> rooms = new HashMap<>();
    private long storedBytes;

    public ShareVideoStore(ShareService shares, Clock clock) { this.shares = shares; this.clock = clock; }

    public synchronized void authorizePublisher(AuthenticatedUser user, UUID course, UUID session, UUID share) {
        publisher(user, course, session, share);
    }

    public synchronized void init(AuthenticatedUser user, UUID course, UUID session, UUID share,
            UUID epoch, String codec, byte[] bytes) {
        VideoScope scope = publisher(user, course, session, share);
        bound(bytes, MAX_INIT);
        String checkedCodec = ShareVideoMp4.init(bytes, codec);
        prune();
        VideoRoom room = rooms.get(share);
        if (room == null) {
            if (rooms.size() >= 64) throw error(HttpStatus.TOO_MANY_REQUESTS, "Достигнут лимит видеопотоков");
            room = new VideoRoom(session, share);
        }
        if (room.retired.contains(epoch)) throw error(HttpStatus.CONFLICT, "Видеопоток уже заменён");
        if (epoch.equals(room.epoch)) {
            if (!checkedCodec.equals(room.codec) || !Arrays.equals(bytes, room.init)) {
                throw error(HttpStatus.CONFLICT, "Инициализация видеопотока уже принята");
            }
            return;
        }
        if (room.retired.size() >= 128) {
            throw error(HttpStatus.TOO_MANY_REQUESTS, "Начните демонстрацию заново");
        }
        budget(storedBytes - room.bytes + bytes.length);
        retire(room);
        room.epoch = epoch; room.codec = checkedCodec; room.init = bytes.clone();
        room.bytes = bytes.length; storedBytes += bytes.length;
        rooms.put(scope.shareId(), room);
    }

    public synchronized void segment(AuthenticatedUser user, UUID course, UUID session, UUID share,
            UUID epoch, long sequence, byte[] bytes) {
        publisher(user, course, session, share);
        bound(bytes, MAX_SEGMENT);
        if (sequence < 0 || sequence == Long.MAX_VALUE) throw error(HttpStatus.BAD_REQUEST, "Некорректный номер");
        ShareVideoMp4.segment(bytes);
        prune();
        VideoRoom room = current(share, epoch);
        Segment existing = room.segments.get(sequence);
        if (existing != null) {
            if (!Arrays.equals(bytes, existing.bytes())) throw error(HttpStatus.CONFLICT, "Сегмент уже принят");
            return;
        }
        if (sequence < room.nextSequence) throw error(HttpStatus.GONE, "Сегмент больше недоступен");
        if (sequence != room.nextSequence) throw error(HttpStatus.CONFLICT, "Нарушена последовательность сегментов");
        TreeMap<Long, Segment> next = new TreeMap<>(room.segments);
        next.put(sequence, new Segment(bytes, clock.instant()));
        long retained = room.bytes + bytes.length;
        while (next.size() > 6 || retained > MAX_ROOM_BYTES) {
            retained -= next.pollFirstEntry().getValue().bytes().length;
        }
        budget(storedBytes - room.bytes + retained);
        next.put(sequence, new Segment(bytes.clone(), clock.instant()));
        storedBytes += retained - room.bytes; room.bytes = retained;
        room.segments = next; room.nextSequence++;
    }

    public synchronized ShareVideoMetadata metadata(ViewerAccess access, UUID viewer) {
        VideoRoom room = read(access, viewer);
        if (room == null || room.epoch == null || room.segments.isEmpty()) return null;
        return new ShareVideoMetadata(room.shareId, room.epoch, room.codec,
                room.segments.firstKey(), room.segments.lastKey());
    }

    public synchronized byte[] initialization(ViewerAccess access, UUID viewer, UUID epoch) {
        VideoRoom room = readable(access, viewer, epoch);
        return room.init.clone();
    }

    public synchronized byte[] fragment(ViewerAccess access, UUID viewer, UUID epoch, long sequence) {
        VideoRoom room = readable(access, viewer, epoch);
        Segment segment = room.segments.get(sequence);
        if (segment == null) throw error(HttpStatus.GONE, "Сегмент больше недоступен");
        return segment.bytes().clone();
    }

    private VideoRoom readable(ViewerAccess access, UUID viewer, UUID epoch) {
        VideoRoom room = read(access, viewer);
        if (room == null || !epoch.equals(room.epoch) || room.init == null || room.segments.isEmpty()) {
            throw error(HttpStatus.GONE, "Видеопоток больше недоступен");
        }
        return room;
    }

    private VideoRoom read(ViewerAccess access, UUID viewer) {
        VideoScope scope = shares.videoViewer(access, viewer);
        prune();
        if (scope == null) return null;
        VideoRoom room = rooms.get(scope.shareId());
        if (scope.paused()) { if (room != null) retire(room); return null; }
        return room;
    }

    private VideoScope publisher(AuthenticatedUser user, UUID course, UUID session, UUID share) {
        VideoScope scope = shares.videoPublisher(user, course, session, share);
        if (scope.paused()) {
            VideoRoom room = rooms.get(share);
            if (room != null) retire(room);
            throw error(HttpStatus.CONFLICT, "Демонстрация на паузе");
        }
        return scope;
    }

    private VideoRoom current(UUID share, UUID epoch) {
        VideoRoom room = rooms.get(share);
        if (room == null || !epoch.equals(room.epoch) || room.init == null) {
            throw error(HttpStatus.CONFLICT, "Сначала начните новый видеопоток");
        }
        return room;
    }

    @EventListener
    public synchronized void stateChanged(SessionStateChanged event) {
        if (event.status() == SessionStatus.LIVE) return;
        for (VideoRoom room : rooms.values()) if (room.sessionId.equals(event.sessionId())) retire(room);
    }

    @Scheduled(fixedDelay = 1000)
    public synchronized void prune() {
        Instant cutoff = clock.instant().minusSeconds(6);
        for (Iterator<VideoRoom> iterator = rooms.values().iterator(); iterator.hasNext();) {
            VideoRoom room = iterator.next();
            if (!shares.videoRoomExists(room.sessionId, room.shareId)) {
                storedBytes -= room.bytes; iterator.remove(); continue;
            }
            while (!room.segments.isEmpty() && !room.segments.firstEntry().getValue().receivedAt().isAfter(cutoff)) {
                int bytes = room.segments.pollFirstEntry().getValue().bytes().length;
                room.bytes -= bytes; storedBytes -= bytes;
            }
        }
    }

    private void retire(VideoRoom room) {
        if (room.epoch != null) room.retired.add(room.epoch);
        storedBytes -= room.bytes;
        room.epoch = null; room.codec = null; room.init = null; room.segments.clear();
        room.bytes = 0; room.nextSequence = 0;
    }
    private void budget(long bytes) {
        if (bytes > MAX_GLOBAL_BYTES) throw error(HttpStatus.TOO_MANY_REQUESTS, "Видеобуфер временно заполнен");
    }
    private void bound(byte[] bytes, int maximum) {
        if (bytes.length > maximum) throw error(HttpStatus.PAYLOAD_TOO_LARGE, "Видеосегмент слишком большой");
    }
    private static ResponseStatusException error(HttpStatus status, String reason) {
        return new ResponseStatusException(status, reason);
    }
    synchronized long storedBytes() { return storedBytes; }

    private record Segment(byte[] bytes, Instant receivedAt) {}
    private static final class VideoRoom {
        final UUID sessionId, shareId;
        final Set<UUID> retired = new HashSet<>();
        UUID epoch;
        String codec;
        byte[] init;
        long nextSequence, bytes;
        TreeMap<Long, Segment> segments = new TreeMap<>();
        VideoRoom(UUID sessionId, UUID shareId) { this.sessionId = sessionId; this.shareId = shareId; }
    }
}
