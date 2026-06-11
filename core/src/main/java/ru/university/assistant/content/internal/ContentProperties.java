package ru.university.assistant.content.internal;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.content")
public record ContentProperties(Path blobRoot, String converterUrl, long maxUploadBytes) {}
