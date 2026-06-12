package ru.university.assistant.content.internal;

public record SlideConversionResult(
        int totalSlides,
        int renderedSlides,
        boolean partial,
        String warningMessage,
        String errorMessage) {}
