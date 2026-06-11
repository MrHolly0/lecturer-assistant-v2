package ru.university.assistant.content.internal;

import java.nio.file.Path;

public record BlobResource(Path path, String contentType) {}
