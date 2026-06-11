package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record SaveAnnotationsRequest(@NotNull Map<String, Object> annotations) {}
