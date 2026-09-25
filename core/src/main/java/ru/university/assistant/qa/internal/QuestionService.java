package ru.university.assistant.qa.internal;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.qa.api.QuestionApi;
import ru.university.assistant.qa.api.QuestionAnswerAudience;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;
import ru.university.assistant.qa.api.QuestionStatus;
import ru.university.assistant.qa.api.ResolvedQuestion;
import ru.university.assistant.qa.api.StudentQuestion;
import ru.university.assistant.qa.api.StudentQuestionAnswer;
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
    public List<QuestionAnswerAudience> answeredQuestions(UUID sessionId) {
        return repository.answeredQuestions(sessionId);
    }

    @Override
    @Transactional
    public ResolvedQuestion resolve(
            UUID sessionId,
            UUID questionId,
            UUID actorPersonId,
            QuestionStatus status,
            String answerText,
            QuestionAnswerVisibility answerVisibility) {
        if (status == QuestionStatus.OPEN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Question can only be answered or dismissed");
        }
        String normalizedAnswer = normalizeAnswer(answerText);
        validateResolution(status, normalizedAnswer, answerVisibility);
        StudentQuestion current = repository.find(sessionId, questionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
        if (current.status() != QuestionStatus.OPEN) {
            return resolution(
                    sessionId,
                    idempotentOrConflict(current, status, normalizedAnswer, answerVisibility),
                    false);
        }
        StudentQuestion resolved = repository.resolve(sessionId, questionId, status, normalizedAnswer, answerVisibility)
                .orElse(null);
        if (resolved == null) {
            return repository.find(sessionId, questionId)
                    .map(found -> idempotentOrConflict(found, status, normalizedAnswer, answerVisibility))
                    .map(found -> resolution(sessionId, found, false))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
        }
        events.publish(new DomainEvent(
                "qa.question",
                resolved.id(),
                status == QuestionStatus.ANSWERED ? "qa.question_answered" : "qa.question_dismissed",
                actorPersonId,
                Map.of("sessionId", sessionId, "questionId", questionId),
                eventPayload(status, answerVisibility)));
        return resolution(sessionId, resolved, true);
    }

    private StudentQuestion idempotentOrConflict(
            StudentQuestion current,
            QuestionStatus requestedStatus,
            String requestedAnswer,
            QuestionAnswerVisibility requestedVisibility) {
        if (current.status() == requestedStatus
                && java.util.Objects.equals(current.answerText(), requestedAnswer)
                && current.answerVisibility() == requestedVisibility) {
            return current;
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Question is already resolved");
    }

    private void validateResolution(
            QuestionStatus status, String answerText, QuestionAnswerVisibility answerVisibility) {
        if (status == QuestionStatus.ANSWERED && (answerText == null || answerVisibility == null)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Answered question requires text and answer visibility");
        }
        if (status == QuestionStatus.DISMISSED && (answerText != null || answerVisibility != null)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Dismissed question cannot contain an answer");
        }
    }

    private Map<String, Object> eventPayload(
            QuestionStatus status, QuestionAnswerVisibility answerVisibility) {
        if (answerVisibility == null) {
            return Map.of("status", status.name(), "hasAnswerText", false);
        }
        return Map.of(
                "status", status.name(),
                "hasAnswerText", true,
                "answerVisibility", answerVisibility.name());
    }

    private ResolvedQuestion resolution(UUID sessionId, StudentQuestion question, boolean changed) {
        UUID authorPersonId = repository.authorPersonId(sessionId, question.id()).orElse(null);
        StudentQuestionAnswer answer = question.status() == QuestionStatus.ANSWERED
                ? new StudentQuestionAnswer(
                        question.id(),
                        question.text(),
                        question.answerText(),
                        question.answerVisibility(),
                        question.answeredAt())
                : null;
        return new ResolvedQuestion(question, authorPersonId, answer, changed);
    }

    private String normalizeAnswer(String answerText) {
        if (answerText == null) {
            return null;
        }
        String normalized = answerText.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
