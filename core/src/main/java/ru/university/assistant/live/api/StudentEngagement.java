package ru.university.assistant.live.api;

import java.util.List;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.qa.api.StudentQuestion;

public record StudentEngagement(SignalAggregate signalAggregate, List<StudentQuestion> questions) {}
