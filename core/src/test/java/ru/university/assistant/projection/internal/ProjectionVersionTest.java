package ru.university.assistant.projection.internal;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ProjectionVersionTest {
    @Test
    void versionsUseNumericStableComponentsAndRejectAmbiguousBuildLabels() {
        assertTrue(ProjectionVersion.older("0.9.9", "0.10.0"));
        assertFalse(ProjectionVersion.older("1.10.0", "1.2.0"));
        assertFalse(ProjectionVersion.older("1.2.3", "1.2.3"));
        assertThrows(IllegalArgumentException.class, () -> ProjectionVersion.older("1.0-beta", "1.0.0"));
        assertThrows(IllegalArgumentException.class, () -> ProjectionVersion.older("999999999999.1.0", "1.0.0"));
    }
}
