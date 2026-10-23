package ru.university.assistant.feedback.api;

import java.util.List;
import java.util.UUID;

public interface FeedbackApi {
    /** slideIdx — номер слайда, на котором сервер сейчас держит сессию (не из клиента, см. D-04). */
    SignalAggregate saveSignal(UUID sessionId, UUID personId, String channelType, int slideIdx, SignalValue value);

    default SignalSubmission submitSignal(
            UUID sessionId, UUID personId, String channelType, int slideIdx, SignalValue value) {
        return new SignalSubmission(saveSignal(sessionId, personId, channelType, slideIdx, value), true);
    }

    record SignalSubmission(SignalAggregate aggregate, boolean changed) {}

    /** Агрегат по одному слайду — обычно текущему. Смена слайда сбрасывает его сама по себе. */
    SignalAggregate aggregate(UUID sessionId, int slideIdx);

    /** Слайды сессии, где были сигналы, отсортированы по числу красных (сначала самые проблемные). */
    List<ProblemSlide> problemSlides(UUID sessionId);
}
