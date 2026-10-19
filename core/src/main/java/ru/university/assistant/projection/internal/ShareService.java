package ru.university.assistant.projection.internal;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.projection.api.ShareContracts.Peer;
import ru.university.assistant.projection.api.ShareContracts.Status;
import ru.university.assistant.projection.api.ShareContracts.Viewer;

/** Bounded signalling and optional HTTPS low-frame-rate previews; no frame history or persistence. */
@Service
public class ShareService {
    private static final int LEASE_SECONDS = 15;
    private static final int MAX_ROOMS = 64;
    private static final int MAX_VIEWERS = 200;
    private final Map<UUID, Room> rooms = new HashMap<>();
    private final Clock clock;
    private final CourseAccessApi courses;
    private final LiveSessionAccessApi sessions;
    private final AccountStateApi accounts;
    private final ShareIceConfiguration ice;

    public ShareService(Clock clock, CourseAccessApi courses, LiveSessionAccessApi sessions,
            AccountStateApi accounts, ShareIceConfiguration ice) {
        this.clock = clock; this.courses = courses; this.sessions = sessions; this.accounts = accounts; this.ice = ice;
    }

    public synchronized Status start(AuthenticatedUser user, UUID courseId, UUID sessionId, String name) {
        LiveSession session = manage(user, courseId, sessionId);
        if (session.status() != SessionStatus.LIVE) throw error(HttpStatus.CONFLICT, "Начните показ и снимите паузу");
        expire();
        Room existing = rooms.get(sessionId);
        if (existing != null) throw error(HttpStatus.CONFLICT, "Демонстрация уже запущена. Сначала остановите её");
        if (rooms.size() >= MAX_ROOMS) throw error(HttpStatus.TOO_MANY_REQUESTS, "Слишком много демонстраций");
        Room room = new Room(UUID.randomUUID(), user.id(), courseId, sessionId,
                name.trim(), now().plusSeconds(LEASE_SECONDS));
        rooms.put(sessionId, room);
        return status(room, false);
    }

    public synchronized Status poll(AuthenticatedUser user, UUID courseId, UUID sessionId, UUID shareId) {
        manage(user, courseId, sessionId);
        Room room = ownerRoom(user, sessionId, shareId);
        room.leaseUntil = now().plusSeconds(LEASE_SECONDS);
        pruneViewers(room);
        boolean paused = sessions.requireSession(sessionId).status() == SessionStatus.PAUSED;
        if (paused) clearFrame(room);
        return status(room, paused);
    }

    public synchronized void offer(AuthenticatedUser user, UUID courseId, UUID sessionId,
            UUID shareId, UUID viewerId, String sdp) {
        manage(user, courseId, sessionId);
        Room room = ownerRoom(user, sessionId, shareId);
        ViewerState viewer = viewer(room, viewerId);
        validateSdp(sdp);
        if (viewer.offer != null && !viewer.offer.equals(sdp)) {
            throw error(HttpStatus.CONFLICT, "Предложение уже отправлено");
        }
        viewer.offer = sdp;
    }

    public synchronized void stop(AuthenticatedUser user, UUID courseId, UUID sessionId, UUID shareId) {
        manage(user, courseId, sessionId);
        Room room = rooms.get(sessionId);
        if (room == null) return;
        if (!room.id.equals(shareId)) throw error(HttpStatus.CONFLICT, "Демонстрация уже изменилась");
        // Any current course manager may explicitly stop a stranded show; cannot hijack its media connection.
        rooms.remove(sessionId);
    }

    public synchronized Viewer view(ViewerAccess access, UUID viewerId) {
        LiveSession session = access.session();
        Room room = activeRoom(session);
        if (room == null) return null;
        pruneViewers(room);
        ViewerState viewer = room.viewers.get(viewerId);
        if (viewer == null) {
            if (room.viewers.size() >= MAX_VIEWERS) {
                throw error(HttpStatus.TOO_MANY_REQUESTS, "Достигнут лимит подключений демонстрации");
            }
            if (room.viewers.values().stream().filter(item -> item.personId.equals(access.personId())).count() >= 2) {
                throw error(HttpStatus.TOO_MANY_REQUESTS, "Уже открыто два подключения демонстрации");
            }
            viewer = new ViewerState(now(), access.personId());
            room.viewers.put(viewerId, viewer);
        }
        if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
        viewer.seenAt = now();
        return new Viewer(room.id, viewer.offer, session.status() == SessionStatus.PAUSED, ice.servers());
    }

    public synchronized void answer(ViewerAccess access, UUID shareId, UUID viewerId, String sdp) {
        LiveSession session = access.session();
        Room room = activeRoom(session);
        if (room == null || !room.id.equals(shareId)) throw error(HttpStatus.GONE, "Демонстрация остановлена");
        validateSdp(sdp);
        ViewerState viewer = viewer(room, viewerId);
        if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
        if (viewer.offer == null) throw error(HttpStatus.CONFLICT, "Предложение ещё не получено");
        if (viewer.answer != null && !viewer.answer.equals(sdp)) {
            throw error(HttpStatus.CONFLICT, "Ответ уже отправлен");
        }
        viewer.answer = sdp; viewer.seenAt = now();
    }

    public synchronized void uploadFrame(AuthenticatedUser user, UUID courseId, UUID sessionId,
            UUID shareId, byte[] bytes) {
        LiveSession session = manage(user, courseId, sessionId);
        Room room = ownerRoom(user, sessionId, shareId);
        if (session.status() == SessionStatus.PAUSED) {
            clearFrame(room);
            throw error(HttpStatus.CONFLICT, "Демонстрация на паузе");
        }
        if (room.frameAt != null && room.frameAt.plusMillis(500).isAfter(now())) {
            throw error(HttpStatus.TOO_MANY_REQUESTS, "Отправляйте не больше двух кадров в секунду");
        }
        ShareFrame.validate(bytes);
        room.frame = bytes;
        room.frameAt = now();
    }

    public synchronized byte[] frame(ViewerAccess access, UUID viewerId) {
        LiveSession session = access.session();
        Room room = activeRoom(session);
        if (room == null) return null;
        pruneViewers(room);
        ViewerState viewer = viewer(room, viewerId);
        if (!viewer.personId.equals(access.personId())) throw error(HttpStatus.FORBIDDEN, "Чужое подключение");
        // Frame requests do not register participants or renew signalling/viewer leases.
        if (session.status() == SessionStatus.PAUSED || room.frameAt == null
                || !room.frameAt.plusSeconds(4).isAfter(now())) {
            clearFrame(room);
            return null;
        }
        return room.frame;
    }

    private void clearFrame(Room room) {
        room.frame = null;
        room.frameAt = null;
    }

    private Room activeRoom(LiveSession session) {
        expire();
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
            rooms.remove(session.id());
            return null;
        }
        if (session.status() == SessionStatus.PAUSED) clearFrame(room);
        return room;
    }
    private LiveSession manage(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        if (user == null || user.role() == PersonRole.STUDENT) {
            throw error(HttpStatus.FORBIDDEN, "Нужны права управления занятием");
        }
        courses.requireManage(user, courseId);
        LiveSession session = sessions.requireSessionInCourse(courseId, sessionId);
        if (session.status() != SessionStatus.LIVE && session.status() != SessionStatus.PAUSED) {
            rooms.remove(sessionId);
            throw error(HttpStatus.CONFLICT, "Занятие не идёт");
        }
        return session;
    }
    private Room ownerRoom(AuthenticatedUser user, UUID sessionId, UUID shareId) {
        expire();
        Room room = rooms.get(sessionId);
        if (room == null || !room.id.equals(shareId)) throw error(HttpStatus.GONE, "Демонстрация остановлена");
        if (!room.owner.equals(user.id())) {
            throw error(HttpStatus.FORBIDDEN, "Демонстрацией управляет другой преподаватель");
        }
        return room;
    }
    private ViewerState viewer(Room room, UUID id) {
        ViewerState viewer = room.viewers.get(id);
        if (viewer == null) throw error(HttpStatus.NOT_FOUND, "Подключение не найдено");
        return viewer;
    }
    private Status status(Room room, boolean paused) {
        return new Status(room.id, room.name, room.leaseUntil, paused,
                room.viewers.entrySet().stream().map(entry -> new Peer(
                        entry.getKey(), entry.getValue().offer, entry.getValue().answer)).toList(), ice.servers());
    }
    private void expire() { rooms.values().removeIf(room -> !room.leaseUntil.isAfter(now())); }
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
        return new ResponseStatusException(status, message);
    }
    private static final class Room {
        final UUID id, owner, courseId, sessionId;
        final String name;
        Instant leaseUntil;
        byte[] frame;
        Instant frameAt;
        final Map<UUID, ViewerState> viewers = new HashMap<>();
        Room(UUID id, UUID owner, UUID courseId, UUID sessionId, String name, Instant leaseUntil) {
            this.id = id;
            this.owner = owner;
            this.courseId = courseId;
            this.sessionId = sessionId;
            this.name = name;
            this.leaseUntil = leaseUntil;
        }
    }
    private static final class ViewerState {
        final UUID personId;
        Instant seenAt;
        String offer, answer;
        ViewerState(Instant seenAt, UUID personId) { this.seenAt = seenAt; this.personId = personId; }
    }
}
