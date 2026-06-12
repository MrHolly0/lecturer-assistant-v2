package ru.university.assistant.content.internal;

public interface SlideConversionSink {
    void metadata(int totalSlides, int renderedSlides, String phase, String warningMessage);

    void slide(ConvertedSlide slide, int processedSlides, int totalSlides);
}
