package ru.university.assistant.channel.api;

public record OutboundContent(ContentType type, String text, String ref, String caption) {
    public static OutboundContent text(String value) {
        return new OutboundContent(ContentType.TEXT, value, null, null);
    }
}
