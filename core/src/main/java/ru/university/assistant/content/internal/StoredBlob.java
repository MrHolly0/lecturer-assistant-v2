package ru.university.assistant.content.internal;

public record StoredBlob(String ref, String filename, String contentType, long sizeBytes) {}
