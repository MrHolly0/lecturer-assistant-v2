package ru.university.assistant.projection.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.projection.api.ShareContracts.Status;
import ru.university.assistant.projection.api.FrameFixture;

/** Tests real room transitions with a deterministic clock and current authorization boundaries. */
class ShareServiceTest {
    private static final String OFFER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n";
    private static final String ANSWER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n";
    private final UUID course = UUID.randomUUID();
    private final UUID sessionId = UUID.randomUUID();
    private final AuthenticatedUser owner = user(PersonRole.LECTURER);
    private final AuthenticatedUser colleague = user(PersonRole.ASSISTANT);
    private final MutableClock clock = new MutableClock();
    private final CourseAccessApi courses = mock(CourseAccessApi.class);
    private final LiveSessionAccessApi sessions = mock(LiveSessionAccessApi.class);
    private final AccountStateApi accounts = mock(AccountStateApi.class);
    private final Map<UUID, LiveSession> currentSessions = new HashMap<>();
    private final Map<UUID, AccountStateApi.State> currentAccounts = new HashMap<>();
    private boolean courseAccess = true;
    private ShareService service;

    @BeforeEach
    void setup() {
        currentSessions.put(sessionId, session(sessionId, SessionStatus.LIVE));
        currentAccounts.put(owner.id(), state(owner, PersonStatus.ACTIVE));
        when(accounts.find(any())).thenAnswer(call -> Optional.ofNullable(currentAccounts.get(call.getArgument(0))));
        when(sessions.requireSessionInCourse(any(), any())).thenAnswer(call -> {
            LiveSession session = currentSessions.get(call.getArgument(1));
            if (session == null || !session.courseId().equals(call.getArgument(0))) throw denied(HttpStatus.NOT_FOUND);
            return session;
        });
        when(sessions.requireSession(any())).thenAnswer(call -> currentSessions.get(call.getArgument(0)));
        doAnswer(call -> {
            if (!courseAccess || !course.equals(call.getArgument(1))) throw denied(HttpStatus.FORBIDDEN);
            return null;
        }).when(courses).requireManage(any(), any());
        service = new ShareService(clock, courses, sessions, accounts, new ShareIceConfiguration("", "", ""));
    }

    @Test
    void roomStartRequiresCurrentCourseScopeStaffAndLiveSession() {
        expect(HttpStatus.FORBIDDEN, () -> service.start(null, course, sessionId, "Window"));
        expect(HttpStatus.FORBIDDEN, () -> service.start(user(PersonRole.STUDENT), course, sessionId, "Window"));
        expect(HttpStatus.FORBIDDEN, () -> service.start(owner, UUID.randomUUID(), sessionId, "Window"));
        expect(HttpStatus.NOT_FOUND, () -> service.start(owner, course, UUID.randomUUID(), "Window"));
        currentSessions.put(sessionId, session(sessionId, SessionStatus.PAUSED));
        expect(HttpStatus.CONFLICT, () -> service.start(owner, course, sessionId, "Window"));
        currentSessions.put(sessionId, session(sessionId, SessionStatus.SCHEDULED));
        expect(HttpStatus.CONFLICT, () -> service.start(owner, course, sessionId, "Window"));
    }

    @Test
    void anotherManagerCanStopButCannotPollOrOfferOnTheOwnersConnection() {
        Status room = start();
        UUID viewer = UUID.randomUUID();
        service.view(access(UUID.randomUUID()), viewer);
        expect(HttpStatus.CONFLICT, () -> service.start(colleague, course, sessionId, "Takeover"));
        expect(HttpStatus.FORBIDDEN, () -> service.poll(colleague, course, sessionId, room.id()));
        expect(HttpStatus.FORBIDDEN, () -> service.offer(colleague, course, sessionId, room.id(), viewer, OFFER));
        expect(HttpStatus.CONFLICT, () -> service.stop(colleague, course, sessionId, UUID.randomUUID()));
        assertNotNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()));
        service.stop(colleague, course, sessionId, room.id());
        assertNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()));
        service.stop(colleague, course, sessionId, room.id());
    }

    @Test
    void onlyOwnerPollRenewsLeaseAndExpiryIsNotRevivedByViewerTraffic() {
        Status room = start();
        clock.advance(14);
        service.view(access(UUID.randomUUID()), UUID.randomUUID());
        clock.advance(1);
        assertNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()));
        expect(HttpStatus.GONE, () -> service.poll(owner, course, sessionId, room.id()));
        Status replacement = start();
        clock.advance(14);
        Status renewed = service.poll(owner, course, sessionId, replacement.id());
        assertEquals(clock.instant().plusSeconds(15), renewed.leaseUntil());
        clock.advance(14);
        assertNotNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()));
        clock.advance(1);
        assertNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()));
    }

    @Test
    void pauseIsExplicitInStaffAndViewerStateAndEndInvalidatesRoom() {
        Status room = start();
        UUID person = UUID.randomUUID(), viewer = UUID.randomUUID();
        service.view(access(person), viewer);
        currentSessions.put(sessionId, session(sessionId, SessionStatus.PAUSED));
        assertTrue(service.poll(owner, course, sessionId, room.id()).paused());
        assertTrue(service.view(access(person), viewer).paused());
        currentSessions.put(sessionId, session(sessionId, SessionStatus.LIVE));
        assertFalse(service.poll(owner, course, sessionId, room.id()).paused());
        currentSessions.put(sessionId, session(sessionId, SessionStatus.ENDED));
        assertNull(service.view(access(person), viewer));
        expect(HttpStatus.CONFLICT, () -> service.poll(owner, course, sessionId, room.id()));
    }

    @Test
    void videoReadsRefreshExistingViewerActivityButNeverPublisherLeaseOrRegisterAViewer() {
        Status room = start();
        UUID person = UUID.randomUUID(), viewer = UUID.randomUUID();
        expect(HttpStatus.NOT_FOUND, () -> service.videoViewer(access(person), viewer));
        service.view(access(person), viewer);
        clock.advance(7);
        assertEquals(room.leaseUntil(), service.videoViewer(access(person), viewer).leaseUntil());
        clock.advance(7);
        assertEquals(room.leaseUntil(), service.videoViewer(access(person), viewer).leaseUntil());
        clock.advance(1);
        assertNull(service.videoViewer(access(person), viewer));
    }

    @Test
    void ownerAccountRemovalDisableRoleDowngradeAndCourseRevocationRevokeTheRoom() {
        for (String revocation : List.of("missing", "disabled", "student", "course")) {
            currentAccounts.put(owner.id(), state(owner, PersonStatus.ACTIVE));
            courseAccess = true;
            start();
            switch (revocation) {
                case "missing" -> currentAccounts.remove(owner.id());
                case "disabled" -> currentAccounts.put(owner.id(), state(owner, PersonStatus.DISABLED));
                case "student" -> currentAccounts.put(owner.id(), new AccountStateApi.State(
                        owner.id(), "Owner", "owner@example.test", PersonRole.STUDENT, PersonStatus.ACTIVE, 0));
                case "course" -> courseAccess = false;
                default -> throw new AssertionError();
            }
            assertNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()), revocation);
            currentAccounts.put(owner.id(), state(owner, PersonStatus.ACTIVE));
            courseAccess = true;
            assertNull(service.view(access(UUID.randomUUID()), UUID.randomUUID()),
                    "Restoring access must not resurrect revoked media");
        }
    }

    @Test
    void viewerIdsAreBoundToPeopleAndCannotReadOrReplaceAnotherPersonsAnswer() {
        Status room = start();
        UUID ownerPerson = UUID.randomUUID(), stranger = UUID.randomUUID(), viewer = UUID.randomUUID();
        service.view(access(ownerPerson), viewer);
        service.offer(owner, course, sessionId, room.id(), viewer, OFFER);
        expect(HttpStatus.FORBIDDEN, () -> service.view(access(stranger), viewer));
        expect(HttpStatus.FORBIDDEN, () -> service.answer(access(stranger), room.id(), viewer, ANSWER));
        service.answer(access(ownerPerson), room.id(), viewer, ANSWER);
        assertEquals(ANSWER, service.poll(owner, course, sessionId, room.id()).peers().getFirst().answer());
    }

    @Test
    void staleShareIdsAndMissingPeersCannotInjectOffersOrAnswersIntoANewRoom() {
        Status old = start();
        service.stop(owner, course, sessionId, old.id());
        Status current = start();
        UUID person = UUID.randomUUID(), viewer = UUID.randomUUID();
        service.view(access(person), viewer);
        expect(HttpStatus.GONE, () -> service.offer(owner, course, sessionId, old.id(), viewer, OFFER));
        expect(HttpStatus.GONE, () -> service.answer(access(person), old.id(), viewer, ANSWER));
        expect(HttpStatus.NOT_FOUND, () -> service.offer(
                owner, course, sessionId, current.id(), UUID.randomUUID(), OFFER));
        expect(HttpStatus.CONFLICT, () -> service.answer(access(person), current.id(), viewer, ANSWER));
        assertNull(service.view(access(person), viewer).offer());
    }

    @Test
    void invalidAndOversizeSdpIsRejectedAndRetriesCannotOverwriteExistingNegotiation() {
        Status room = start();
        UUID person = UUID.randomUUID(), viewer = UUID.randomUUID();
        service.view(access(person), viewer);
        for (String invalid : new String[] {
                null, "", "v=1\r\nm=video", "v=0\r\nm=audio", OFFER + "x".repeat(65537) }) {
            expect(HttpStatus.BAD_REQUEST, () -> service.offer(owner, course, sessionId, room.id(), viewer, invalid));
        }
        service.offer(owner, course, sessionId, room.id(), viewer, OFFER);
        service.offer(owner, course, sessionId, room.id(), viewer, OFFER);
        expect(HttpStatus.CONFLICT, () -> service.offer(
                owner, course, sessionId, room.id(), viewer, OFFER + "a=inactive\r\n"));
        expect(HttpStatus.BAD_REQUEST, () -> service.answer(access(person), room.id(), viewer, "v=0\r\nm=audio"));
        service.answer(access(person), room.id(), viewer, ANSWER);
        service.answer(access(person), room.id(), viewer, ANSWER);
        expect(HttpStatus.CONFLICT, () -> service.answer(access(person), room.id(), viewer, ANSWER + "a=inactive\r\n"));
    }

    @Test
    void viewerLimitsArePerPersonAndPerRoomAndExpiredViewersReleaseTheirSlots() {
        Status room = start();
        UUID person = UUID.randomUUID();
        service.view(access(person), UUID.randomUUID());
        service.view(access(person), UUID.randomUUID());
        expect(HttpStatus.TOO_MANY_REQUESTS, () -> service.view(access(person), UUID.randomUUID()));
        for (int index = 2; index < 200; index++) service.view(access(UUID.randomUUID()), UUID.randomUUID());
        expect(HttpStatus.TOO_MANY_REQUESTS, () -> service.view(access(UUID.randomUUID()), UUID.randomUUID()));
        assertEquals(200, service.poll(owner, course, sessionId, room.id()).peers().size());
        clock.advance(9);
        assertNotNull(service.view(access(person), UUID.randomUUID()));
        assertEquals(1, service.poll(owner, course, sessionId, room.id()).peers().size());
    }

    @Test
    void globalRoomBoundIsEnforcedAndExpiredRoomsFreeCapacity() {
        for (int index = 0; index < 64; index++) {
            UUID id = UUID.randomUUID();
            currentSessions.put(id, session(id, SessionStatus.LIVE));
            service.start(owner, course, id, "Window " + index);
        }
        expect(HttpStatus.TOO_MANY_REQUESTS, this::start);
        clock.advance(15);
        assertNotNull(start());
    }

    @Test
    void iceServersAreOptInAndInvalidUrlsFailConfiguration() {
        assertEquals(List.of(), new ShareIceConfiguration("", "", "").servers());
        var configured = new ShareIceConfiguration(
                "stun:ice.example.test:3478, turns:ice.example.test:5349", "institution-user", "test-credential");
        assertEquals(2, configured.servers().getFirst().urls().size());
        assertEquals("institution-user", configured.servers().getFirst().username());
        for (String url : List.of("https://ice.example.test", "turn:host with spaces", "file:/tmp/ice")) {
            assertThrows(IllegalArgumentException.class, () -> new ShareIceConfiguration(url, "", ""));
        }
    }

    @Test
    void previewFramesAreOwnerOnlyViewerBoundRateLimitedAndExpireWithoutRenewingLeases() throws Exception {
        Status room = start();
        UUID person = UUID.randomUUID(), viewer = UUID.randomUUID();
        byte[] first = FrameFixture.jpeg(16, 9), second = FrameFixture.jpeg(32, 18);
        service.view(access(person), viewer);
        assertNull(service.frame(access(person), viewer));
        expect(HttpStatus.FORBIDDEN, () -> service.uploadFrame(colleague, course, sessionId, room.id(), first));
        service.uploadFrame(owner, course, sessionId, room.id(), first);
        assertArrayEquals(first, service.frame(access(person), viewer));
        expect(HttpStatus.FORBIDDEN, () -> service.frame(access(UUID.randomUUID()), viewer));
        expect(HttpStatus.NOT_FOUND, () -> service.frame(access(person), UUID.randomUUID()));
        expect(HttpStatus.TOO_MANY_REQUESTS, () -> service.uploadFrame(owner, course, sessionId, room.id(), second));
        clock.advanceMillis(500);
        service.uploadFrame(owner, course, sessionId, room.id(), second);
        assertArrayEquals(second, service.frame(access(person), viewer));
        clock.advance(4);
        assertNull(service.frame(access(person), viewer));
        service.uploadFrame(owner, course, sessionId, room.id(), first);
        currentSessions.put(sessionId, session(sessionId, SessionStatus.PAUSED));
        assertNull(service.frame(access(person), viewer));
        expect(HttpStatus.CONFLICT, () -> service.uploadFrame(owner, course, sessionId, room.id(), first));
        currentSessions.put(sessionId, session(sessionId, SessionStatus.LIVE));
        assertNull(service.frame(access(person), viewer));
        service.uploadFrame(owner, course, sessionId, room.id(), first);
        clock.advance(4);
        expect(HttpStatus.NOT_FOUND, () -> service.frame(access(person), viewer));
        // Fetching images did not keep the viewer alive: only its signalling poll can do that.
        service.view(access(person), viewer);
        service.uploadFrame(owner, course, sessionId, room.id(), second);
        clock.advance(15);
        assertNull(service.frame(access(person), viewer));
    }

    private Status start() { return service.start(owner, course, sessionId, "Teaching window"); }
    private ViewerAccess access(UUID person) { return new ViewerAccess(currentSessions.get(sessionId), person); }
    private LiveSession session(UUID id, SessionStatus status) {
        return new LiveSession(id, course, UUID.randomUUID(), UUID.randomUUID(), "Lesson", List.of(),
                status, "ABC123", 1, Map.of(), clock.instant(), null, null, 0, 0);
    }
    private static AuthenticatedUser user(PersonRole role) {
        return new AuthenticatedUser(UUID.randomUUID(), "Fixture", "fixture@example.test", role);
    }
    private static AccountStateApi.State state(AuthenticatedUser user, PersonStatus status) {
        return new AccountStateApi.State(user.id(), user.displayName(), user.email(), user.role(), status, 0);
    }
    private static ResponseStatusException denied(HttpStatus status) { return new ResponseStatusException(status); }
    private static void expect(HttpStatus status, org.junit.jupiter.api.function.Executable action) {
        assertEquals(status, assertThrows(ResponseStatusException.class, action).getStatusCode());
    }
    private static final class MutableClock extends Clock {
        private Instant time = Instant.parse("2026-10-19T12:00:00Z");
        void advance(long seconds) { time = time.plusSeconds(seconds); }
        void advanceMillis(long milliseconds) { time = time.plusMillis(milliseconds); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return time; }
    }
}
