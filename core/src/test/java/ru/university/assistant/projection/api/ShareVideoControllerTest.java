package ru.university.assistant.projection.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import ru.university.assistant.projection.internal.ShareVideoStore;

class ShareVideoControllerTest {
    @Test
    void dishonestChunkedBodiesAreBoundedAndDeclaredOversizeIsNotRead() throws Exception {
        ShareVideoStore store = mock(ShareVideoStore.class);
        ShareVideoController controller = controller(store);
        for (boolean init : new boolean[] {true, false}) {
            int maximum = init ? ShareVideoStore.MAX_INIT : ShareVideoStore.MAX_SEGMENT;
            for (long length : new long[] {-1, 1, maximum + 1L}) {
                var source = new ByteArrayInputStream(new byte[maximum + 10]);
                HttpServletRequest request = mock(HttpServletRequest.class);
                when(request.getContentLengthLong()).thenReturn(length);
                when(request.getInputStream()).thenReturn(new DelegatingServletInputStream(source));
                var error = assertThrows(ResponseStatusException.class, () -> {
                    if (init) controller.init(null, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                            UUID.randomUUID(), VideoFixture.CODEC, request);
                    else controller.segment(null, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                            UUID.randomUUID(), 0, request);
                });
                assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, error.getStatusCode());
                assertEquals(length > maximum ? maximum + 10 : 9, source.available());
            }
        }
    }

    @Test
    void publisherAuthorizationPrecedesReadingAnyBinaryBody() throws Exception {
        ShareVideoStore store = mock(ShareVideoStore.class);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(store)
                .authorizePublisher(any(), any(), any(), any());
        HttpServletRequest request = mock(HttpServletRequest.class);
        assertThrows(ResponseStatusException.class, () -> controller(store).init(null, UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), VideoFixture.CODEC, request));
        verify(request, never()).getInputStream();
    }

    private ShareVideoController controller(ShareVideoStore store) {
        return new ShareVideoController(store, mock(MediaViewingAccessApi.class), mock(ProjectionService.class));
    }
}
