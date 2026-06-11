package ru.university.assistant.org.api;

import java.util.UUID;

public record Course(UUID id, String title, UUID ownerPersonId, boolean archived) {}
