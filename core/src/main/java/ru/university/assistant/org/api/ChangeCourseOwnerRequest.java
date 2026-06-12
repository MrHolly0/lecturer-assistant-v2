package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record ChangeCourseOwnerRequest(@NotNull UUID personId) {}
