package ru.university.assistant.projection.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.DelegatingServletInputStream;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.live.api.MediaViewingAccessApi;
import ru.university.assistant.projection.internal.ProjectionService;
import ru.university.assistant.projection.internal.ShareService;

class ShareFrameControllerTest {
    @Test
    void missingOrDishonestContentLengthCannotAllocateOrReadAnUnboundedBody() throws Exception {
        ShareService shares = mock(ShareService.class);
        ShareController controller = new ShareController(shares,
                mock(MediaViewingAccessApi.class), mock(ProjectionService.class));
        int maximum = 256 * 1024;
        for (long length : new long[] { -1, 1 }) {
            var source = new ByteArrayInputStream(new byte[maximum + 10]);
            HttpServletRequest request = mock(HttpServletRequest.class);
            when(request.getContentLengthLong()).thenReturn(length);
            when(request.getInputStream()).thenReturn(new DelegatingServletInputStream(source));
            ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> controller.uploadFrame(
                    null, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), request));
            assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, error.getStatusCode());
            assertEquals(9, source.available());
        }
        HttpServletRequest declared = mock(HttpServletRequest.class);
        when(declared.getContentLengthLong()).thenReturn((long) maximum + 1);
        assertThrows(ResponseStatusException.class, () -> controller.uploadFrame(
                null, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), declared));
        verify(declared, never()).getInputStream();
        verifyNoInteractions(shares);
    }
}
