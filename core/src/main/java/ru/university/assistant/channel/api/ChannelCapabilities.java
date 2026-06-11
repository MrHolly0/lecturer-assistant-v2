package ru.university.assistant.channel.api;

import jakarta.validation.constraints.Min;

public record ChannelCapabilities(
        boolean inlineButtons,
        boolean editMessage,
        boolean images,
        @Min(1) int maxTextLength,
        @Min(1) int maxButtonsPerRow) {}
