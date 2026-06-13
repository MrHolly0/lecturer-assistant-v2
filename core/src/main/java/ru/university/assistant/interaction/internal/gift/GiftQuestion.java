package ru.university.assistant.interaction.internal.gift;

import java.util.List;

public record GiftQuestion(
        String title,
        String text,
        GiftQuestionType type,
        List<GiftAnswer> answers) {}
