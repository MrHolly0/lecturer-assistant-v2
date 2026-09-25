package ru.university.assistant.live.api;

import jakarta.validation.constraints.Size;
import java.util.UUID;

public record StartSessionGroup(UUID groupId, @Size(max = 120) String groupName) {}
