package ru.university.assistant.interaction.api;

import java.util.Optional;
import java.util.UUID;

/** SPI для live-модуля: вставка ActivePollView в снапшот и регистрация ответов студентов. */
public interface QuickPollApi {
    /** Открытый опрос сессии, а если его нет — последний закрытый (студент должен увидеть результат). */
    Optional<ActivePollView> activePollForSession(UUID sessionId);

    /** Ответ студента. Опрос обязан принадлежать сессии; первый ответ фиксируется, повторный не засчитывается. */
    PollVote respond(UUID sessionId, UUID pollId, UUID personId, int optionIdx);

    Integer myVote(UUID pollId, UUID personId);
}
