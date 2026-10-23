package ru.university.assistant.live.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record SaveAnnotationsRequest(@NotNull Map<String, Object> annotations, @Min(0) Long expectedVersion) {
    public SaveAnnotationsRequest(Map<String, Object> annotations) {
        this(annotations, null);
    }
}
