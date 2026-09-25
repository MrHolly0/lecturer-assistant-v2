package ru.university.assistant.qa.internal;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.qa.api.QuestionApi;
import ru.university.assistant.qa.api.QuestionStatus;
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

    @Override
    @Transactional
    public StudentQuestion resolve(
            UUID sessionId,
            UUID questionId,
            UUID actorPersonId,
            QuestionStatus status,
            String answerText) {
        if (status == QuestionStatus.OPEN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Question can only be answered or dismissed");
        }
        String normalizedAnswer = normalizeAnswer(answerText);
        StudentQuestion current = repository.find(sessionId, questionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
        if (current.status() != QuestionStatus.OPEN) {
            return idempotentOrConflict(current, status, normalizedAnswer);
        }
        StudentQuestion resolved = repository.resolve(sessionId, questionId, status, normalizedAnswer)
                .orElse(null);
        if (resolved == null) {
            return repository.find(sessionId, questionId)
                    .map(found -> idempotentOrConflict(found, status, normalizedAnswer))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
        }
        events.publish(new DomainEvent(
                "qa.question",
                resolved.id(),
                status == QuestionStatus.ANSWERED ? "qa.question_answered" : "qa.question_dismissed",
                actorPersonId,
                Map.of("sessionId", sessionId, "questionId", questionId),
                Map.of("status", status.name(), "hasAnswerText", normalizedAnswer != null)));
        return resolved;
    }

    private StudentQuestion idempotentOrConflict(
            StudentQuestion current, QuestionStatus requestedStatus, String requestedAnswer) {
        if (current.status() == requestedStatus
                && java.util.Objects.equals(current.answerText(), requestedAnswer)) {
            return current;
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Question is already resolved");
    }

    private String normalizeAnswer(String answerText) {
        if (answerText == null) {
            return null;
        }
        String normalized = answerText.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
