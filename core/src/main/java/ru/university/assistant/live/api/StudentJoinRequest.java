package ru.university.assistant.live.api;

import jakarta.validation.constraints.Size;

public record StudentJoinRequest(@Size(min = 2, max = 120) String displayName) {}
