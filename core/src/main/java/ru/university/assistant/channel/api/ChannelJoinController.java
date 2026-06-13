package ru.university.assistant.channel.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Отдаёт фронту цели подключения по каналам, чтобы окно «Подключение» собрало
 * deep-link и QR на каждый канал. Источник — конфиг развёртывания (боты заводятся
 * по мере подключения каналов: Telegram — фаза 4, ВКонтакте — фаза 8).
 */
@RestController
public class ChannelJoinController {
    private final String telegramBot;
    private final String vkBot;

    ChannelJoinController(
            @Value("${app.channel.telegram-bot:}") String telegramBot,
            @Value("${app.channel.vk-bot:}") String vkBot) {
        this.telegramBot = telegramBot;
        this.vkBot = vkBot;
    }

    @GetMapping("/api/v1/config/channels")
    public ChannelJoinConfig channels() {
        return new ChannelJoinConfig(blankToNull(telegramBot), blankToNull(vkBot));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
