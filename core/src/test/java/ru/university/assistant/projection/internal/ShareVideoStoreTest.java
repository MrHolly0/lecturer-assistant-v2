package ru.university.assistant.projection.internal;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.live.api.SessionStateChanged;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.projection.api.VideoFixture;
import ru.university.assistant.projection.internal.ShareService.VideoScope;

class ShareVideoStoreTest {
    private final MutableClock clock = new MutableClock();
    private final ShareService shares = mock(ShareService.class);
    private final UUID session = UUID.randomUUID(), share = UUID.randomUUID(), epoch = UUID.randomUUID();
    private final UUID viewer = UUID.randomUUID();
    private final Map<UUID, UUID> active = new HashMap<>();
    private final ViewerAccess access = new ViewerAccess(null, UUID.randomUUID());
    private ShareVideoStore store;

    @BeforeEach
    void setup() {
        active.put(share, session);
        when(shares.videoPublisher(any(), any(), any(), any())).thenAnswer(call ->
                new VideoScope(call.getArgument(2), call.getArgument(3), clock.instant().plusSeconds(15), false));
        // Null identity is only used in this storage-only fixture; HTTP tests use real credentials.
        when(shares.videoPublisher(null, null, session, share)).thenReturn(
                new VideoScope(session, share, clock.instant().plusSeconds(15), false));
        when(shares.videoViewer(access, viewer)).thenReturn(
                new VideoScope(session, share, clock.instant().plusSeconds(15), false));
        when(shares.videoRoomExists(any(), any())).thenAnswer(call ->
                call.getArgument(0).equals(active.get(call.getArgument(1))));
        store = new ShareVideoStore(shares, clock);
    }

    @Test
    void videoSupportsBoth4kOrientationsWithinTheSamePixelBudget() {
        assertEquals(VideoFixture.CODEC, ShareVideoMp4.init(VideoFixture.init(3840, 2160), VideoFixture.CODEC));
        assertEquals(VideoFixture.CODEC, ShareVideoMp4.init(VideoFixture.init(2160, 3840), VideoFixture.CODEC));
        expect(HttpStatus.BAD_REQUEST, () -> ShareVideoMp4.init(VideoFixture.init(3000, 3000), VideoFixture.CODEC));
        expect(HttpStatus.BAD_REQUEST, () -> ShareVideoMp4.init(VideoFixture.init(3841, 1000), VideoFixture.CODEC));
    }

    @Test
    void contiguousIdempotentPublicationAndLateJoinStartAtRetainedKeyframe() {
        initialize(epoch);
        assertNull(store.metadata(access, viewer));
        byte[] segment = VideoFixture.segment();
        put(epoch, 0, segment); put(epoch, 0, segment);
        assertArrayEquals(VideoFixture.init(), store.initialization(access, viewer, epoch));
        segment[segment.length - 1] = 1;
        expect(HttpStatus.CONFLICT, () -> put(epoch, 0, segment));
        expect(HttpStatus.CONFLICT, () -> put(epoch, 2, VideoFixture.segment()));
        for (int sequence = 1; sequence < 9; sequence++) put(epoch, sequence, VideoFixture.segment());
        var metadata = store.metadata(access, viewer);
        assertEquals(3, metadata.firstSequence()); assertEquals(8, metadata.lastSequence());
        expect(HttpStatus.GONE, () -> store.fragment(access, viewer, epoch, 0));
        byte[] returned = store.fragment(access, viewer, epoch, 8); returned[returned.length - 1] = 7;
        assertArrayEquals(VideoFixture.segment(), store.fragment(access, viewer, epoch, 8));
        initialize(epoch); // identical init retry never resets accepted sequence
        expect(HttpStatus.CONFLICT, () -> put(epoch, 10, VideoFixture.segment()));
    }

    @Test
    void expiredFragmentsPauseAndReplacedEpochCannotReplayOldVideo() {
        initialize(epoch); put(epoch, 0, VideoFixture.segment());
        clock.advance(6);
        assertNull(store.metadata(access, viewer));
        expect(HttpStatus.GONE, () -> store.fragment(access, viewer, epoch, 0));
        put(epoch, 1, VideoFixture.segment());
        store.stateChanged(new SessionStateChanged(session, SessionStatus.PAUSED));
        store.stateChanged(new SessionStateChanged(session, SessionStatus.LIVE));
        assertNull(store.metadata(access, viewer));
        expect(HttpStatus.CONFLICT, () -> initialize(epoch));
        UUID second = UUID.randomUUID(); initialize(second); put(second, 0, VideoFixture.segment());
        expect(HttpStatus.GONE, () -> store.initialization(access, viewer, epoch));
        UUID third = UUID.randomUUID(); initialize(third);
        expect(HttpStatus.CONFLICT, () -> initialize(second));
        active.clear(); store.prune();
        assertEquals(0, store.storedBytes());
    }

    @Test
    void roomAndGlobalBudgetsAreBoundedAndRejectionDoesNotCorruptAcceptedRing() {
        initialize(epoch);
        byte[] large = VideoFixture.segment(2 * 1024 * 1024 - 256);
        for (int i = 0; i < 7; i++) put(epoch, i, large);
        assertTrue(store.storedBytes() <= ShareVideoStore.MAX_ROOM_BYTES);
        assertTrue(store.metadata(access, viewer).firstSequence() > 0);
        for (int i = 0; i < 20; i++) {
            UUID nextShare = UUID.randomUUID(), nextSession = UUID.randomUUID(), nextEpoch = UUID.randomUUID();
            active.put(nextShare, nextSession);
            when(shares.videoPublisher(null, null, nextSession, nextShare)).thenReturn(
                    new VideoScope(nextSession, nextShare, clock.instant().plusSeconds(15), false));
            try {
                store.init(null, null, nextSession, nextShare, nextEpoch, VideoFixture.CODEC, VideoFixture.init());
                for (int part = 0; part < 4; part++) {
                    store.segment(null, null, nextSession, nextShare, nextEpoch, part, large);
                }
            } catch (ResponseStatusException rejected) {
                assertEquals(HttpStatus.TOO_MANY_REQUESTS, rejected.getStatusCode());
            }
            assertTrue(store.storedBytes() <= ShareVideoStore.MAX_GLOBAL_BYTES);
        }
        assertArrayEquals(large, store.fragment(access, viewer, epoch, 6));
    }

    @Test
    void initCodecMp4FramingAndRequestBoundsAreCheckedWithoutDecoding() {
        expect(HttpStatus.BAD_REQUEST, () -> store.init(null, null, session, share, epoch,
                "avc1.640028", VideoFixture.init()));
        initialize(epoch);
        expect(HttpStatus.BAD_REQUEST, () -> put(epoch, 0, new byte[] {0, 0, 0, 0}));
        byte[] malformed = VideoFixture.segment(); malformed[0] = 0x7f;
        expect(HttpStatus.BAD_REQUEST, () -> put(epoch, 0, malformed));
        expect(HttpStatus.PAYLOAD_TOO_LARGE, () -> put(epoch, 0, new byte[ShareVideoStore.MAX_SEGMENT + 1]));
        expect(HttpStatus.PAYLOAD_TOO_LARGE, () -> store.init(null, null, session, share, UUID.randomUUID(),
                VideoFixture.CODEC, new byte[ShareVideoStore.MAX_INIT + 1]));
        put(epoch, 0, VideoFixture.segment());
    }

    private void initialize(UUID value) {
        store.init(null, null, session, share, value, VideoFixture.CODEC, VideoFixture.init());
    }
    private void put(UUID value, long sequence, byte[] bytes) {
        store.segment(null, null, session, share, value, sequence, bytes);
    }
    private void expect(HttpStatus status, Runnable operation) {
        assertEquals(status, assertThrows(ResponseStatusException.class, operation::run).getStatusCode());
    }
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-19T10:00:00Z");
        void advance(long seconds) { now = now.plusSeconds(seconds); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
