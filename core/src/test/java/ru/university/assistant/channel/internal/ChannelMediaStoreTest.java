package ru.university.assistant.channel.internal;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ChannelMediaStoreTest {
    private final MutableClock clock = new MutableClock();
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final ChannelMediaStore store = new ChannelMediaStore(channels, clock);
    private final UUID person = UUID.randomUUID();
    private final UUID identity = UUID.randomUUID();
    private final UUID share = UUID.randomUUID();

    @Test
    void deduplicatesExactFrameAndLimitsNewRequestsWithoutEvictingTheRequestedFile() {
        when(channels.isActiveMaxIdentity(person, identity)).thenReturn(true);
        byte[] bytes = { 1, 2, 3 };
        ChannelMediaStore.Staged first = store.stage(person, identity, share, clock.instant(), bytes);
        assertEquals(first, store.stage(person, identity, share, clock.instant(), bytes));
        bytes[0] = 9;
        assertArrayEquals(new byte[] { 1, 2, 3 }, store.file(token(first)).bytes());
        clock.advance(Duration.ofSeconds(1));
        assertStatus(429, () -> store.stage(person, identity, share, clock.instant(), bytes));
        clock.advance(Duration.ofSeconds(9));
        ChannelMediaStore.Staged next = store.stage(person, identity, share, clock.instant(), bytes);
        assertNotEquals(first.deliveryId(), next.deliveryId());
        assertArrayEquals(new byte[] { 1, 2, 3 }, store.file(token(first)).bytes());
    }

    @Test
    void mediaExpiresAfterTenMinutesAndReturnedArraysCannotMutateTheStoredFrame() {
        when(channels.isActiveMaxIdentity(person, identity)).thenReturn(true);
        ChannelMediaStore.Staged file = store.stage(person, identity, share, clock.instant(), new byte[] { 7 });
        store.file(token(file)).bytes()[0] = 3;
        assertArrayEquals(new byte[] { 7 }, store.file(token(file)).bytes());
        clock.advance(Duration.ofMinutes(10));
        assertStatus(410, () -> store.file(token(file)));
        assertStatus(410, () -> store.file("unknown"));
    }

    @Test
    void revokedAccountOrMaxBindingInvalidatesTheFileIncludingSubsequentRetrieval() {
        when(channels.isActiveMaxIdentity(person, identity)).thenReturn(true);
        ChannelMediaStore.Staged file = store.stage(person, identity, share, clock.instant(), new byte[] { 7 });
        store.file(token(file));
        when(channels.isActiveMaxIdentity(person, identity)).thenReturn(false);
        assertStatus(410, () -> store.file(token(file)));
        when(channels.isActiveMaxIdentity(person, identity)).thenReturn(true);
        assertStatus(410, () -> store.file(token(file)));
    }

    @Test
    void globalByteCapRejectsAdditionalFilesAndExpiredFilesReleaseCapacity() {
        when(channels.isActiveMaxIdentity(any(), any())).thenReturn(true);
        byte[] maximum = new byte[256 * 1024];
        ChannelMediaStore.Staged first = null;
        for (int i = 0; i < 128; i++) {
            ChannelMediaStore.Staged next = store.stage(UUID.randomUUID(), identity, share, clock.instant(), maximum);
            if (first == null) first = next;
        }
        assertStatus(429, () -> store.stage(UUID.randomUUID(), identity, share, clock.instant(), new byte[] { 1 }));
        assertArrayEquals(maximum, store.file(token(first)).bytes());
        clock.advance(Duration.ofMinutes(10));
        store.stage(person, identity, share, clock.instant(), maximum);
    }

    @Test
    void rejectsFutureTimeAndOversizedOrEmptyFiles() {
        assertStatus(409, () -> store.stage(person, identity, share,
                clock.instant().plusSeconds(1), new byte[] { 1 }));
        assertStatus(400, () -> store.stage(person, identity, share, clock.instant(), new byte[0]));
        assertStatus(400, () -> store.stage(person, identity, share, clock.instant(), new byte[256 * 1024 + 1]));
    }

    private String token(ChannelMediaStore.Staged file) {
        return file.ref().substring(file.ref().lastIndexOf('/') + 1);
    }

    private void assertStatus(int status, Runnable action) {
        assertEquals(status, assertThrows(ResponseStatusException.class, action::run).getStatusCode().value());
    }

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-19T15:00:00Z");
        void advance(Duration amount) { now = now.plus(amount); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
