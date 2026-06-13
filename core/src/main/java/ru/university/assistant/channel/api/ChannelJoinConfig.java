package ru.university.assistant.channel.api;

/**
 * Цели подключения студента по каналам: имя бота в Telegram и сообщество/бот ВК.
 * {@code null} означает, что канал ещё не настроен — фронт показывает «скоро».
 */
public record ChannelJoinConfig(String telegramBot, String vkBot) {}
