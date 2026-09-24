package ru.university.assistant.shared.api;

import java.util.Arrays;
import java.util.List;

/**
 * B-13: разбор конфигурации {@code app.security.cors-allowed-origins} — общий для HTTP CORS
 * и вебсокета, чтобы адрес стенда был задан в одном месте, а не в двух конфигурациях.
 */
public final class OriginList {
    private OriginList() {}

    public static List<String> parse(String commaSeparated) {
        if (commaSeparated == null) {
            return List.of();
        }
        return Arrays.stream(commaSeparated.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isBlank())
                .toList();
    }
}
