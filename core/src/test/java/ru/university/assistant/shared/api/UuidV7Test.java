package ru.university.assistant.shared.api;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class UuidV7Test {
    @Test
    void generatedUuidAlwaysKeepsVersionSeven() {
        for (int index = 0; index < 128; index++) {
            assertEquals(7, UuidV7.generate().version());
        }
    }
}
