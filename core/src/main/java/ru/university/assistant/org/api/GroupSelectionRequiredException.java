package ru.university.assistant.org.api;

import java.util.List;

public final class GroupSelectionRequiredException extends RuntimeException {
    private final List<StudyGroup> allowedGroups;

    public GroupSelectionRequiredException(List<StudyGroup> allowedGroups) {
        super("A group must be selected before joining this session");
        this.allowedGroups = List.copyOf(allowedGroups);
    }

    public List<StudyGroup> allowedGroups() {
        return allowedGroups;
    }
}
