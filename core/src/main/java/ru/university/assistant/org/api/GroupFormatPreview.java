package ru.university.assistant.org.api;

import java.util.Map;

public record GroupFormatPreview(boolean valid, String name, String identityKey,
        Map<String, String> parts, String message) {}
