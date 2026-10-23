package ru.university.assistant.projection.internal;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.context.event.EventListener;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.shared.api.CapacityUnavailableException;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.SessionStateChanged;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.projection.api.ShareContracts.Peer;
import ru.university.assistant.projection.api.ShareContracts.Status;
import ru.university.assistant.projection.api.ShareContracts.Viewer;

/** Process-local bounded signalling. Authorization/DB calls never hold the room or admission lock. */
@Service
public class ShareService {
    private static final int LEASE_SECONDS = 15;
    private final Map<UUID, Room> rooms = new ConcurrentHashMap<>();
    private final Object admission = new Object();
    private final AtomicLong frameBytes = new AtomicLong();
    private final Clock clock;
    private final CourseAccessApi courses;
    private final LiveSessionAccessApi sessions;
    private final AccountStateApi accounts;
    private final ShareIceConfiguration ice;
    private final ShareCapacityProperties capacity;

    public ShareService(Clock clock, CourseAccessApi courses, LiveSessionAccessApi sessions,
            AccountStateApi accounts, ShareIceConfiguration ice) {
        this(clock, courses, sessions, accounts, ice, new ShareCapacityProperties(), null);
    }

    @Autowired
    ShareService(Clock clock, CourseAccessApi courses, LiveSessionAccessApi sessions,
            AccountStateApi accounts, ShareIceConfiguration ice,
            ShareCapacityProperties capacity, MeterRegistry meters) {
        this.clock = clock; this.courses = courses; this.sessions = sessions;
        this.accounts = accounts; this.ice = ice; this.capacity = capacity;
        if (meters != null) {
            meters.gauge("projection.rooms", rooms, Map::size);
            meters.gauge("projection.frame.bytes", frameBytes);
        }
    }

    public Status start(AuthenticatedUser user, UUID courseId, UUID sessionId, String name) {
        LiveSession session = manage(user, courseId, sessionId);
        if (session.status() != SessionStatus.LIVE) throw error(HttpStatus.CONFLICT, "Начните показ и снимите паузу");
        expire();
        synchronized (admission) {
            if (rooms.containsKey(sessionId)) {
                throw error(HttpStatus.CONFLICT, "Демонстрация уже запущена. Сначала остановите её");
            }
            if (rooms.size() >= capacity.getRooms()) {
                throw error(HttpStatus.TOO_MANY_REQUESTS, "Слишком много демонстраций");
            }
            Room room = new Room(UUID.randomUUID(), user.id(), courseId, sessionId,
                    name.trim(), now().plusSeconds(LEASE_SECONDS));
            rooms.put(sessionId, room);
            return status(room, false);
        }
    }

    public Status poll(AuthenticatedUser user, UUID courseId, UUID sessionId, UUID shareId) {
        LiveSession session = manage(user, courseId, sessionId);
        Room room = ownerRoom(user, sessionId, shareId);
        synchronized (room) {
            requireCurrent(room);
            room.leaseUntil = now().plusSeconds(LEASE_SECONDS);
            pruneViewers(room);
            boolean paused = session.status() == SessionStatus.PAUSED;
            if (paused) clearFrame(room);
            return status(room, paused);
        }
    }

    public void offer(AuthenticatedUser user, UUID courseId, UUID sessionId,
            UUID shareId, UUID viewerId, String sdp) {
        manage(user, courseId, sessionId);
        validateSdp(sdp);
        Room room = ownerRoom(user, sessionId, shareId);
        synchronized (room) {
            requireCurrent(room);
            ViewerState viewer = viewer(room, viewerId);
            if (viewer.offer != null && !viewer.offer.equals(sdp)) {
                throw error(HttpStatus.CONFLICT, "Предложение уже отправлено");
            }
            viewer.offer = sdp;
        }
    }

    public void stop(AuthenticatedUser user, UUID courseId, UUID sessionId, UUID shareId) {
        manage(user, courseId, sessionId);
        Room room = rooms.get(sessionId);
        if (room == null) return;
        synchronized (room) {
            if (!room.id.equals(shareId)) throw error(HttpStatus.CONFLICT, "Демонстрация уже изменилась");
            remove(room);
        }
    }

    public Viewer view(ViewerAccess access, UUID viewerId) {
        LiveSession session = access.session();
        Room room = activeRoom(session);
        if (room == null) return null;
        synchronized (room) {
            requireCurrent(room);
            pruneViewers(room);
            ViewerState viewer = room.viewers.get(viewerId);
            if (viewer == null) {
                if (room.viewers.size() >= capacity.getViewersPerRoom()) {
                    throw error(HttpStatus.TOO_MANY_REQUESTS, "Достигнут лимит подключений демонстрации");
                }
                if (room.viewers.values().stream()
                        .filter(item -> item.personId.equals(access.personId())).count() >= 2) {
                    throw error(HttpStatus.TOO_MANY_REQUESTS, "Уже открыто два подключения демонстрации");
                }
                viewer = new ViewerState(now(), access.personId());
                room.viewers.put(viewerId, viewer);
            }
            if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
            viewer.seenAt = now();
            return new Viewer(room.id, viewer.offer, session.status() == SessionStatus.PAUSED, ice.servers());
        }
    }

    public void answer(ViewerAccess access, UUID shareId, UUID viewerId, String sdp) {
        Room room = activeRoom(access.session());
        if (room == null || !room.id.equals(shareId)) throw error(HttpStatus.GONE, "Демонстрация остановлена");
        validateSdp(sdp);
        synchronized (room) {
            requireCurrent(room);
            ViewerState viewer = viewer(room, viewerId);
            if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
            if (viewer.offer == null) throw error(HttpStatus.CONFLICT, "Предложение ещё не получено");
            if (viewer.answer != null && !viewer.answer.equals(sdp)) {
                throw error(HttpStatus.CONFLICT, "Ответ уже отправлен");
            }
            viewer.answer = sdp; viewer.seenAt = now();
        }
    }

    public void uploadFrame(AuthenticatedUser user, UUID courseId, UUID sessionId, UUID shareId, byte[] bytes) {
        LiveSession session = manage(user, courseId, sessionId);
        Room room = ownerRoom(user, sessionId, shareId);
        ShareFrame.validate(bytes);
        synchronized (room) {
            requireCurrent(room);
            if (room.paused || session.status() == SessionStatus.PAUSED) {
                clearFrame(room); throw error(HttpStatus.CONFLICT, "Демонстрация на паузе");
            }
            if (room.frameAt != null && room.frameAt.plusMillis(500).isAfter(now())) {
                throw error(HttpStatus.TOO_MANY_REQUESTS, "Отправляйте не больше двух кадров в секунду");
            }
            long delta = bytes.length - (room.frame == null ? 0 : room.frame.length);
            long total = frameBytes.addAndGet(delta);
            if (total > capacity.getFrameBytes()) {
                frameBytes.addAndGet(-delta);
                throw error(HttpStatus.TOO_MANY_REQUESTS, "Буфер демонстраций временно заполнен");
            }
            room.frame = bytes.clone(); room.frameAt = now();
        }
    }

    public byte[] frame(ViewerAccess access, UUID viewerId) {
        Room room = activeRoom(access.session());
        if (room == null) return null;
        synchronized (room) {
            requireCurrent(room); pruneViewers(room);
            ViewerState viewer = viewer(room, viewerId);
            if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
            if (access.session().status() == SessionStatus.PAUSED || !freshFrame(room)) {
                clearFrame(room); return null;
            }
            return room.frame.clone();
        }
    }

    public record ChatFrame(UUID shareId, Instant receivedAt, byte[] bytes) {}
    public ChatFrame currentFrameForChat(ViewerAccess access) {
        Room room = activeRoom(access.session());
        if (room == null) return null;
        synchronized (room) {
            requireCurrent(room);
            if (access.session().status() == SessionStatus.PAUSED || !freshFrame(room)) return null;
            return new ChatFrame(room.id, room.frameAt, room.frame.clone());
        }
    }
    public record VideoScope(UUID sessionId, UUID shareId, Instant leaseUntil, boolean paused) {}
    public VideoScope videoPublisher(AuthenticatedUser user, UUID courseId, UUID sessionId, UUID shareId) {
        LiveSession session = manage(user, courseId, sessionId);
        Room room = ownerRoom(user, sessionId, shareId);
        synchronized (room) {
            requireCurrent(room);
            return new VideoScope(sessionId, room.id, room.leaseUntil, session.status() == SessionStatus.PAUSED);
        }
    }
    public VideoScope videoViewer(ViewerAccess access, UUID viewerId) {
        Room room = activeRoom(access.session());
        if (room == null) return null;
        synchronized (room) {
            requireCurrent(room); pruneViewers(room);
            ViewerState viewer = viewer(room, viewerId);
            if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
            viewer.seenAt = now();
            return new VideoScope(access.session().id(), room.id, room.leaseUntil,
                    access.session().status() == SessionStatus.PAUSED);
        }
    }
    boolean videoRoomExists(UUID sessionId, UUID shareId) {
        Room room = rooms.get(sessionId);
        return room != null && room.id.equals(shareId) && room.leaseUntil.isAfter(now());
    }
    boolean videoRoomPaused(UUID sessionId, UUID shareId) {
        Room room = rooms.get(sessionId);
        return room != null && room.id.equals(shareId) && room.paused;
    }
    @EventListener
    public void stateChanged(SessionStateChanged event) {
        Room room = rooms.get(event.sessionId());
        if (room == null) return;
        synchronized (room) {
            room.paused = event.status() == SessionStatus.PAUSED;
            if (event.status() == SessionStatus.LIVE) return;
            clearFrame(room);
            if (event.status() != SessionStatus.PAUSED) remove(room);
        }
    }
    private boolean freshFrame(Room room) {
        return !room.paused && room.frameAt != null && room.frameAt.plusSeconds(4).isAfter(now());
    }
    private void clearFrame(Room room) {
        if (room.frame != null) frameBytes.addAndGet(-room.frame.length);
        room.frame = null; room.frameAt = null;
    }
    private void remove(Room room) {
        if (rooms.remove(room.sessionId, room)) clearFrame(room);
    }
    private Room activeRoom(LiveSession session) {
        Room room = rooms.get(session.id());
        if (room == null) return null;
        try {
            var state = accounts.find(room.owner).orElseThrow(() -> error(HttpStatus.FORBIDDEN, "Аккаунт недоступен"));
            if (state.status() != PersonStatus.ACTIVE || state.role() == PersonRole.STUDENT) {
                throw error(HttpStatus.FORBIDDEN, "Доступ отозван");
            }
            courses.requireManage(new AuthenticatedUser(
                    state.id(), state.displayName(), state.email(), state.role()), room.courseId);
            if (session.status() != SessionStatus.LIVE && session.status() != SessionStatus.PAUSED) {
                throw error(HttpStatus.GONE, "Занятие завершено");
            }
        } catch (ResponseStatusException denied) {
            synchronized (room) { remove(room); }
            return null;
        }
        synchronized (room) {
            if (rooms.get(session.id()) != room || !room.leaseUntil.isAfter(now())) { remove(room); return null; }
            if (session.status() == SessionStatus.PAUSED) clearFrame(room);
        }
        return room;
    }
    private LiveSession manage(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        if (user == null || user.role() == PersonRole.STUDENT) {
            throw error(HttpStatus.FORBIDDEN, "Нужны права управления занятием");
        }
        courses.requireManage(user, courseId);
        LiveSession session = sessions.requireSessionInCourse(courseId, sessionId);
        if (session.status() != SessionStatus.LIVE && session.status() != SessionStatus.PAUSED) {
            Room room = rooms.get(sessionId);
            if (room != null) synchronized (room) { remove(room); }
            throw error(HttpStatus.CONFLICT, "Занятие не идёт");
        }
        return session;
    }
    private Room ownerRoom(AuthenticatedUser user, UUID sessionId, UUID shareId) {
        Room room = rooms.get(sessionId);
        if (room == null || !room.id.equals(shareId)) throw error(HttpStatus.GONE, "Демонстрация остановлена");
        if (!room.owner.equals(user.id())) {
            throw error(HttpStatus.FORBIDDEN, "Демонстрацией управляет другой преподаватель");
        }
        return room;
    }
    private void requireCurrent(Room room) {
        if (rooms.get(room.sessionId) != room || !room.leaseUntil.isAfter(now())) {
            remove(room); throw error(HttpStatus.GONE, "Демонстрация остановлена");
        }
    }
    private ViewerState viewer(Room room, UUID id) {
        ViewerState viewer = room.viewers.get(id);
        if (viewer == null) throw error(HttpStatus.NOT_FOUND, "Подключение не найдено");
        return viewer;
    }
    private Status status(Room room, boolean paused) {
        return new Status(room.id, room.name, room.leaseUntil, paused,
                room.viewers.entrySet().stream().map(entry -> new Peer(entry.getKey(), entry.getValue().offer,
                        entry.getValue().answer)).toList(), ice.servers());
    }
    private void expire() {
        for (Room room : rooms.values()) synchronized (room) {
            if (!room.leaseUntil.isAfter(now())) remove(room);
        }
    }
    private void pruneViewers(Room room) {
        room.viewers.values().removeIf(viewer -> viewer.seenAt.isBefore(now().minusSeconds(8)));
    }
    private Instant now() { return clock.instant(); }
    private static void validateSdp(String sdp) {
        if (sdp == null || sdp.length() > 65536 || !sdp.startsWith("v=0") || !sdp.contains("m=video")) {
            throw error(HttpStatus.BAD_REQUEST, "Некорректное описание видеопотока");
        }
    }
    private static ResponseStatusException error(HttpStatus status, String message) {
        return status == HttpStatus.TOO_MANY_REQUESTS
                ? new CapacityUnavailableException(status, message, 1)
                : new ResponseStatusException(status, message);
    }
    private static final class Room {
        final UUID id, owner, courseId, sessionId;
        final String name;
        volatile Instant leaseUntil;
        volatile boolean paused;
        byte[] frame;
        Instant frameAt;
        final Map<UUID, ViewerState> viewers = new HashMap<>();
        Room(UUID id, UUID owner, UUID courseId, UUID sessionId, String name, Instant leaseUntil) {
            this.id = id; this.owner = owner; this.courseId = courseId; this.sessionId = sessionId;
            this.name = name; this.leaseUntil = leaseUntil;
        }
    }
    private static final class ViewerState {
        final UUID personId;
        Instant seenAt;
        String offer, answer;
        ViewerState(Instant seenAt, UUID personId) { this.seenAt = seenAt; this.personId = personId; }
    }
}
