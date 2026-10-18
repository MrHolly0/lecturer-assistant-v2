package ru.university.assistant.iam.api;

import java.util.List;

public record UserPage(List<UserProfile> items, long total, int limit, int offset) {}
