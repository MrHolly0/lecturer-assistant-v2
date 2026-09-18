package ru.university.assistant.interaction.api;

/** Итог ответа студента на опрос: засчитан ли он и какой выбор зафиксирован (первый ответ не меняется). */
public record PollVote(boolean accepted, Integer myVote) {}
