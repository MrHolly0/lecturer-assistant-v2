package ru.university.assistant.channel.api;

import java.util.List;

public record OutboxBatch(List<OutboundMessage> messages) {}
