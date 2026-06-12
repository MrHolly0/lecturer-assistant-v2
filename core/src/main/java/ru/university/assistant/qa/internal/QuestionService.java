package ru.university.assistant.qa.internal;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.qa.api.QuestionApi;
import ru.university.assistant.qa.api.StudentQuestion;
import ru.university.assistant.shared.api.UuidV7;

@Service
class QuestionService implements QuestionApi {
    private final QuestionRepository repository;
    private final EventBus events;

    QuestionService(QuestionRepository repository, EventBus events) {
        this.repository = repository;
        this.events = events;
    }

    @Override
    @Transactional
    public StudentQuestion ask(UUID sessionId, UUID personId, String displayName, String channelType, String text) {
        StudentQuestion question = repository.create(UuidV7.generate(), sessionId, personId,
                displayName, channelType, text.trim());
        events.publish(new DomainEvent(
                "qa.question",
                question.id(),
                "qa.question_asked",
                personId,
                Map.of("sessionId", sessionId),
                Map.of("channelType", channelType)));
        return question;
    }

    @Override
    public List<StudentQuestion> openQuestions(UUID sessionId) {
        return repository.openQuestions(sessionId);
    }
}
