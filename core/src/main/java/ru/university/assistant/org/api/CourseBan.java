package ru.university.assistant.org.api;

import java.time.Instant;
import java.util.UUID;

public record CourseBan(UUID courseId, UUID personId, String reason, Instant bannedAt) {}
