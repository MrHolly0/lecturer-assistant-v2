package ru.university.assistant.content.api;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import java.util.UUID;

public record ReorderSlidesRequest(@NotEmpty List<UUID> slideIds) {}
