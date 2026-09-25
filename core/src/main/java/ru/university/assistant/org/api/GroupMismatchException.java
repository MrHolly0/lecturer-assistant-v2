package ru.university.assistant.org.api;

import java.util.List;

public final class GroupMismatchException extends RuntimeException {
    private final StudyGroup currentGroup;
    private final List<StudyGroup> allowedGroups;

    public GroupMismatchException(StudyGroup currentGroup, List<StudyGroup> allowedGroups) {
        super("Student already belongs to another group in this course");
        this.currentGroup = currentGroup;
        this.allowedGroups = List.copyOf(allowedGroups);
    }

    public StudyGroup currentGroup() {
        return currentGroup;
    }

    public List<StudyGroup> allowedGroups() {
        return allowedGroups;
    }
}
