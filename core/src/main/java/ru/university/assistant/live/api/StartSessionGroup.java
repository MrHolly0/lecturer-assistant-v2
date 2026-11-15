package ru.university.assistant.live.api;

import jakarta.validation.constraints.Size;
import java.util.UUID;
import java.util.Map;

public record StartSessionGroup(UUID groupId, @Size(max = 120) String groupName,
        @Size(max = 8) Map<@Size(max = 32) String, @Size(max = 160) String> parts) {
    public StartSessionGroup(UUID groupId, String groupName) { this(groupId, groupName, null); }
}
