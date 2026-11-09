package ru.university.assistant.qa.api;

import java.util.List;
import java.util.UUID;

public interface QuestionApi {
    QuestionAuthorModeration moderateAuthor(
            UUID sessionId, UUID questionId, UUID actorPersonId, boolean muted, boolean hideQuestions);

    java.util.Set<UUID> mutedAuthors(UUID sessionId, java.util.Set<UUID> personIds);

    void transferAuthorMute(UUID sessionId, UUID guestId, UUID personId);

    StudentQuestion ask(
            UUID sessionId, UUID personId, String displayName, String channelType, String text,
            boolean anonymous, Integer slideIdx);

    List<StudentQuestion> openQuestions(UUID sessionId);

    QuestionPage list(UUID sessionId, QuestionStatus status, int limit, int offset);

    QuestionPage list(UUID sessionId, QuestionStatus status, int limit, int offset, String query);

    List<QuestionAnswerAudience> answeredQuestions(UUID sessionId);

    java.util.Map<UUID, List<StudentQuestion>> personalQuestions(UUID sessionId, java.util.Set<UUID> personIds);

    ResolvedQuestion resolve(
            UUID sessionId,
            UUID questionId,
            UUID actorPersonId,
            QuestionStatus status,
            String answerText,
            QuestionAnswerVisibility answerVisibility);
}
