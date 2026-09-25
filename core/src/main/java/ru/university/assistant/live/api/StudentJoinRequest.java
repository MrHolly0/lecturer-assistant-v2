package ru.university.assistant.live.api;

import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * displayName нужен только анонимному входу; пустое или короткое имя заменяется на «Гость …».
 * participantToken позволяет анонимному студенту вернуться в лекцию
 * тем же участником, а не создавать нового.
 */
public record StudentJoinRequest(@Size(max = 120) String displayName, String participantToken, UUID groupId) {}
