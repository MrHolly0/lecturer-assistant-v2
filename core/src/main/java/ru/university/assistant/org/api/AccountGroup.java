package ru.university.assistant.org.api;

import java.util.List;
import java.util.UUID;

/** A display grouping for the administrator account directory, not a new membership. */
public record AccountGroup(
        String id, String parentId, String name, String description, String icon, List<UUID> personIds) {}
