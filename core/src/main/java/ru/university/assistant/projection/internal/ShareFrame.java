package ru.university.assistant.projection.internal;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** A bounded JPEG preview, never decoded to an unbounded raster or cached on disk. */
final class ShareFrame {
    static final int MAX_BYTES = 256 * 1024;

    private ShareFrame() {}

    static void validate(byte[] bytes) {
        if (bytes.length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Кадр больше 256 КБ");
        }
        if (bytes.length < 4 || bytes[0] != (byte) 0xff || bytes[1] != (byte) 0xd8
                || bytes[bytes.length - 2] != (byte) 0xff || bytes[bytes.length - 1] != (byte) 0xd9) {
            throw invalid();
        }
        ImageReader reader = ImageIO.getImageReadersByFormatName("JPEG").next();
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            reader.setInput(input, true, true);
            // Metadata only: never call read(), which would allocate a raster from attacker dimensions.
            int width = reader.getWidth(0), height = reader.getHeight(0);
            if (width < 1 || height < 1 || width > 960 || height > 540) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Размер кадра должен быть не больше 960 × 540");
            }
        } catch (IOException | IllegalArgumentException exception) {
            throw invalid();
        } finally {
            reader.dispose();
        }
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Требуется корректный кадр JPEG");
    }
}
