package ru.university.assistant.live.api;

import jakarta.validation.constraints.Size;

/**
 * displayName нужен только анонимному входу. participantToken позволяет анонимному студенту вернуться в лекцию
 * тем же участником, а не создавать нового.
 */
public record StudentJoinRequest(@Size(min = 2, max = 120) String displayName, String participantToken) {}
