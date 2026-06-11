package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.junit.jupiter.api.Test;

class JwtServiceTest {
    @Test
    void rejectsDevelopmentSecretWhenStrongSecretIsRequired() {
        assertThrows(
                IllegalStateException.class,
                () -> new JwtService(
                        new ObjectMapper(),
                        Clock.systemUTC(),
                        "phase-1-local-development-secret-change-me",
                        15,
                        true));
    }
}
