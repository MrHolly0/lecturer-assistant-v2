package ru.university.assistant.channel.internal;

import java.time.Duration;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.channel.api.ChannelCapabilities;
import ru.university.assistant.channel.api.ChannelFanoutApi;
import ru.university.assistant.channel.api.ChannelInternalApi;
import ru.university.assistant.channel.api.DeliveryReportBatch;
import ru.university.assistant.channel.api.InboundEvent;
import ru.university.assistant.channel.api.OutboundContent;
import ru.university.assistant.channel.api.OutboundMessage;
import ru.university.assistant.channel.api.OutboundPriority;
import ru.university.assistant.channel.api.OutboxBatch;
import ru.university.assistant.channel.api.ReplyMode;
import ru.university.assistant.iam.api.ChannelIdentityApi;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class ChannelService implements ChannelInternalApi, ChannelFanoutApi {
    private static final Duration LOCK_TTL = Duration.ofSeconds(60);
    private static final String HELP_TEXT = """
            Команды:
            /join КОД — подключиться к live-сессии
            /current — получить текущий слайд
            /prev — запросить предыдущий слайд
            /question — задать вопрос
            /rate — отправить сигнал понимания
            /profile — профиль студента
            /help — помощь
            """;

    private final ChannelRepository channels;
    private final ChannelIdentityApi identities;

    ChannelService(ChannelRepository channels, ChannelIdentityApi identities) {
        this.channels = channels;
        this.identities = identities;
    }

    @Transactional
    public void registerCapabilities(String channelType, ChannelCapabilities capabilities) {
        channels.saveCapabilities(channelType.toLowerCase(), capabilities);
    }

    public OutboxBatch poll(String channelType, Duration wait, int limit) {
        long deadline = System.nanoTime() + wait.toNanos();
        List<OutboundMessage> messages;
        do {
            messages = channels.claim(channelType.toLowerCase(), limit, (int) LOCK_TTL.toSeconds());
            if (!messages.isEmpty() || System.nanoTime() >= deadline) {
                return new OutboxBatch(messages);
            }
            sleepBriefly();
        } while (true);
    }

    @Transactional
    public void report(String channelType, DeliveryReportBatch batch) {
        batch.reports().forEach(report -> channels.saveReport(channelType.toLowerCase(), report));
    }

    @Transactional
    public void handleInbound(String channelType, InboundEvent event) {
        identities
                .findByExternalId(channelType.toLowerCase(), event.externalUserId())
                .ifPresent(identity -> enqueueCommandResponse(channelType.toLowerCase(), identity.id(), event.text()));
    }

    @Override
    @Transactional
    public void sessionSlideChanged(LiveSession session) {
        channels.recipientsForSession(session.id()).forEach(recipient -> channels.enqueue(
                recipient.channelType(),
                new OutboundMessage(
                        UuidV7.generate(),
                        recipient.channelIdentityId(),
                        null,
                        OutboundPriority.P2_SLIDE,
                        OutboundContent.text("Текущий слайд: " + session.currentSlideIdx()),
                        List.of(),
                        ReplyMode.EDIT_LAST,
                        "slide")));
    }

    private void enqueueCommandResponse(String channelType, java.util.UUID identityId, String text) {
        String normalized = text == null ? "" : text.trim().toLowerCase();
        String response = switch (normalized.split("\\s+", 2)[0]) {
            case "/start", "/help" -> HELP_TEXT;
            case "/current" -> "Текущий слайд придёт следующим сообщением, когда лектор начнёт показ.";
            case "/prev" -> "Предыдущий слайд будет доступен после полной интеграции истории показа.";
            case "/join" -> "Введите код подключения после команды: /join КОД";
            case "/question" -> "Напишите вопрос следующим сообщением.";
            case "/rate" -> "Оценка понимания появится в фазе Interaction Engine.";
            case "/profile" -> "Профиль будет заполнен через ProfileFlow.";
            default -> "Не понял команду. Отправьте /help.";
        };
        channels.enqueue(
                channelType,
                new OutboundMessage(
                        UuidV7.generate(),
                        identityId,
                        null,
                        OutboundPriority.P0_INTERACTIVE,
                        OutboundContent.text(response),
                        List.of(),
                        ReplyMode.NEW,
                        "dialog"));
    }

    private void sleepBriefly() {
        try {
            Thread.sleep(500);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }
}
