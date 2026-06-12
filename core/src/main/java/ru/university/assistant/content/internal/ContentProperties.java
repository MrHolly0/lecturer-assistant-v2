package ru.university.assistant.content.internal;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.content")
public record ContentProperties(
        Path blobRoot,
        String converterUrl,
        long maxUploadBytes,
        String slideImageUrlSecret,
        Duration slideImageUrlTtl,
        Duration converterConnectTimeout,
        Duration converterReadTimeout,
        int importCorePoolSize,
        int importMaxPoolSize,
        int importQueueCapacity) {}
