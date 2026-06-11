package ru.university.assistant.content.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SaveSlideNoteRequest(@NotNull @Size(max = 20000) String content) {}
