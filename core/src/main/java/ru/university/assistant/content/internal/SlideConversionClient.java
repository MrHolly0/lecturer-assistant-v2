package ru.university.assistant.content.internal;

import java.util.UUID;

public interface SlideConversionClient {
    SlideConversionResult convert(StoredBlob source, String outputPrefix, UUID jobId, SlideConversionSink sink);
}
