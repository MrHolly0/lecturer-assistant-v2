package ru.university.assistant.channel.api;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.channel.internal.ChannelMediaStore;

class ChannelMediaControllerTest {
    private final ChannelMediaStore media = mock(ChannelMediaStore.class);
    private final ChannelMediaController controller = new ChannelMediaController(media, "internal-only-secret");

    @Test
    void requiresAdapterKeyBeforeLookingUpAnyOpaqueToken() {
        for (String key : new String[] { null, "", "wrong" }) {
            assertEquals(401, assertThrows(ResponseStatusException.class,
                    () -> controller.file("opaque", key)).getStatusCode().value());
        }
        verifyNoInteractions(media);
    }

    @Test
    void servesOriginalBytesAsNonCacheableAttachmentToTheAdapter() {
        byte[] jpeg = { 1, 2, 3 };
        when(media.file("opaque")).thenReturn(
                new ChannelMediaStore.MediaFile(jpeg, "demonstration-20261019T150000Z.jpg"));
        ResponseEntity<byte[]> result = controller.file("opaque", "internal-only-secret");
        assertArrayEquals(jpeg, result.getBody());
        assertEquals("no-store", result.getHeaders().getCacheControl());
        assertEquals("nosniff", result.getHeaders().getFirst("X-Content-Type-Options"));
        assertEquals("image/jpeg", result.getHeaders().getContentType().toString());
        assertEquals("demonstration-20261019T150000Z.jpg", result.getHeaders().getContentDisposition().getFilename());
    }
}
