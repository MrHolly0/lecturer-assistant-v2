package ru.university.assistant.content.internal;

import java.io.IOException;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnMissingBean(SlideConversionClient.class)
class PlaceholderSlideConversionClient implements SlideConversionClient {
    private static final byte[] PNG = java.util.Base64.getDecoder()
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQ5yYwAAAABJRU5ErkJggg==");

    private final BlobStorage blobStorage;

    PlaceholderSlideConversionClient(BlobStorage blobStorage) {
        this.blobStorage = blobStorage;
    }

    @Override
    public SlideConversionResult convert(
            StoredBlob source, String outputPrefix, UUID jobId, SlideConversionSink sink) {
        try {
            StoredBlob image = blobStorage.storeBytes(PNG, "slide-1.png", "image/png");
            sink.metadata(1, 1, "RENDERING 0/1", null);
            sink.slide(new ConvertedSlide(1, image.ref(), "Preview for " + source.filename(), false), 1, 1);
            return new SlideConversionResult(1, 1, false, null, null);
        } catch (IOException exception) {
            throw new IllegalStateException("Cannot create placeholder preview", exception);
        }
    }
}
