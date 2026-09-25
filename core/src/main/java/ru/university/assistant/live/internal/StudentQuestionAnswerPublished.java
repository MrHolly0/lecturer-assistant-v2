package ru.university.assistant.live.internal;

import java.util.UUID;
import ru.university.assistant.qa.api.StudentQuestionAnswer;

record StudentQuestionAnswerPublished(
        String joinCode,
        UUID authorPersonId,
        StudentQuestionAnswer answer) {}
