package ru.university.assistant.shared.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SystemControllerTest {

    @Test
    void returnsBootstrapStatus() {
        SystemController controller = new SystemController("test-version");

        SystemInfo info = controller.info();

        assertThat(info.name()).isEqualTo("lecturer-assistant-v2");
        assertThat(info.version()).isEqualTo("test-version");
        assertThat(info.status()).isEqualTo("BOOTSTRAPPED");
    }
}
