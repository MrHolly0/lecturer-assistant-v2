package ru.university.assistant.projection.internal;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.projection.api.FrameFixture;

class ShareFrameTest {
    @Test
    void previewDimensionsAndCompressedBytesAreBoundedBeforeRasterAllocation() throws Exception {
        assertDoesNotThrow(() -> ShareFrame.validate(FrameFixture.jpeg(960, 540)));
        expect(HttpStatus.BAD_REQUEST, FrameFixture.jpeg(961, 200));
        expect(HttpStatus.BAD_REQUEST, FrameFixture.jpeg(200, 541));
        expect(HttpStatus.PAYLOAD_TOO_LARGE, new byte[ShareFrame.MAX_BYTES + 1]);
        expect(HttpStatus.BAD_REQUEST, new byte[] { 1, 2, 3, 4 });
        expect(HttpStatus.BAD_REQUEST, new byte[] { (byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9 });
        byte[] huge = FrameFixture.jpeg(16, 9);
        for (int i = 0; i < huge.length - 8; i++) {
            if (huge[i] == (byte) 0xff && huge[i + 1] == (byte) 0xc0) {
                huge[i + 5] = 0x7f;
                huge[i + 6] = (byte) 0xff;
                huge[i + 7] = 0x7f;
                huge[i + 8] = (byte) 0xff;
                break;
            }
        }
        expect(HttpStatus.BAD_REQUEST, huge);
    }

    private void expect(HttpStatus status, byte[] bytes) {
        assertEquals(status, assertThrows(ResponseStatusException.class, () -> ShareFrame.validate(bytes))
                .getStatusCode());
    }
}
