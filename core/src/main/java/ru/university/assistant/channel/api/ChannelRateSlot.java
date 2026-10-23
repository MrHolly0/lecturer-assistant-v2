package ru.university.assistant.channel.api;

public record ChannelRateSlot(long delayMs, boolean reserved) {
    public ChannelRateSlot(long delayMs) { this(delayMs, true); }
}
