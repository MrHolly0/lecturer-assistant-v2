package ru.university.assistant.live.api;

import jakarta.validation.constraints.Min;

public record ChangeSlideRequest(@Min(1) int slideIdx, @Min(0) Long expectedVersion) {
    public ChangeSlideRequest(int slideIdx) {
        this(slideIdx, null);
    }
}
