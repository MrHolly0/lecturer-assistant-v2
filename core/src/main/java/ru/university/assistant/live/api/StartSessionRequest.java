package ru.university.assistant.live.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record StartSessionRequest(
        @NotNull @Size(min = 1, max = 50) List<@Valid StartSessionGroup> groups) {}
