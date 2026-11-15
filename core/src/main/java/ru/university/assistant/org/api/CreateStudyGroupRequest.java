package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateStudyGroupRequest(@NotBlank @Size(min = 1, max = 100) String name,
        @Size(max = 8) java.util.Map<String, String> parts) {
    public CreateStudyGroupRequest(String name) { this(name, null); }
}
