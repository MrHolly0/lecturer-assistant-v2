package ru.university.assistant.projection.internal;

import ru.university.assistant.projection.api.ProjectionContracts;

/** Deliberately restricted stable three-component versions; comparison is numeric. */
final class ProjectionVersion {
    private ProjectionVersion() {}

    static boolean older(String current, String minimum) {
        if (!current.matches(ProjectionContracts.VERSION_PATTERN)
                || !minimum.matches(ProjectionContracts.VERSION_PATTERN)) {
            throw new IllegalArgumentException("Invalid helper version");
        }
        String[] left = current.split("\\.");
        String[] right = minimum.split("\\.");
        for (int i = 0; i < left.length; i++) {
            int comparison = Integer.compare(Integer.parseInt(left[i]), Integer.parseInt(right[i]));
            if (comparison != 0) {
                return comparison < 0;
            }
        }
        return false;
    }
}
