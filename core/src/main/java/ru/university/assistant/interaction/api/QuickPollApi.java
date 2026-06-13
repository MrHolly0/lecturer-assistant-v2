package ru.university.assistant.interaction.api;

import java.util.Optional;
import java.util.UUID;

/** SPI для live-модуля: вставка ActivePollView в SSE-снапшот и регистрация ответов студентов. */
public interface QuickPollApi {
    Optional<ActivePollView> activePollForSession(UUID sessionId);

    void respond(UUID pollId, UUID personId, int optionIdx);
}
