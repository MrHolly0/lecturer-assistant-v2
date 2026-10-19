package ru.university.assistant.projection.api;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import javax.imageio.ImageIO;

/** Synthetic fixture only; no user screenshots are read or written to disk. */
public final class FrameFixture {
    private FrameFixture() {}

    public static byte[] jpeg(int width, int height) throws IOException {
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "JPEG", bytes);
        return bytes.toByteArray();
    }
}
