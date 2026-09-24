package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotNull;
import ru.university.assistant.feedback.api.SignalValue;

/**
 * slideIdx в теле — только для отладки/совместимости с клиентом; сервер ставит сигнал на
 * тот слайд, на котором сам держит сессию сейчас (D-04), а не на присланный студентом номер.
 */
public record StudentSignalRequest(String participantToken, @NotNull SignalValue value, Integer slideIdx) {}
