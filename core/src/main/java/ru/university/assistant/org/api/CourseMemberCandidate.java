package ru.university.assistant.org.api;

import java.util.UUID;

public record CourseMemberCandidate(UUID personId, String displayName, boolean alreadyMember) {}
