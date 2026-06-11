package ru.university.assistant.content.internal;

import java.util.List;

public interface SlideConversionClient {
    List<ConvertedSlide> convert(StoredBlob source, String outputPrefix);
}
