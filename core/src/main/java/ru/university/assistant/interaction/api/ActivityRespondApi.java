package ru.university.assistant.interaction.api;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** SPI для live-модуля: регистрация ответов студентов на активность. */
public interface ActivityRespondApi {
    ActivityResponse submitResponse(UUID sessionId, UUID runId, UUID personId, UUID questionId, JsonNode answer);
}
