package ru.university.assistant.projection.internal;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.shared.api.ScreenFrameLimits;

/** A bounded JPEG preview, never decoded to an unbounded raster or cached on disk. */
final class ShareFrame {
    static final int MAX_BYTES = ScreenFrameLimits.MAX_BYTES;

    private ShareFrame() {}

    static void validate(byte[] bytes) {
        if (bytes.length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Кадр больше 2 МиБ");
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
            if (width < 1 || height < 1 || width > ScreenFrameLimits.MAX_DIMENSION
                    || height > ScreenFrameLimits.MAX_DIMENSION
                    || (long) width * height > ScreenFrameLimits.MAX_PIXELS) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Размер кадра ограничен 4K: сторона до 3840 пикселей, не больше 8 294 400 пикселей");
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
