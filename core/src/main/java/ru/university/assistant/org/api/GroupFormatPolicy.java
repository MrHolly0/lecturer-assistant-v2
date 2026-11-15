package ru.university.assistant.org.api;

import java.util.List;

/** Institution policy. Field ids carry meaning; prefixes only control presentation. */
public record GroupFormatPolicy(long revision, boolean enabled, List<Field> fields) {
    public record Field(String id, String label, String kind, String prefix, int width,
            int yearBase, String defaultValue, List<Choice> choices) {}
    public record Choice(String code, String label, List<String> aliases) {}
}
