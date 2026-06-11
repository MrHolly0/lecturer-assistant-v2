package ru.university.assistant.org.api;

import java.util.UUID;

public record StudyGroup(UUID id, UUID courseId, String name) {}
