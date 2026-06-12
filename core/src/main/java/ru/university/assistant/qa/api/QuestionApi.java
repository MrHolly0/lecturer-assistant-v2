package ru.university.assistant.qa.api;

import java.util.List;
import java.util.UUID;

public interface QuestionApi {
    StudentQuestion ask(UUID sessionId, UUID personId, String displayName, String channelType, String text);

    List<StudentQuestion> openQuestions(UUID sessionId);
}
