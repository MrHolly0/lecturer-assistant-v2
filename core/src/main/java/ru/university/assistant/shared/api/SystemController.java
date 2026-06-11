package ru.university.assistant.shared.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private final String version;

    public SystemController(@Value("${app.version}") String version) {
        this.version = version;
    }

    @GetMapping("/info")
    public SystemInfo info() {
        return new SystemInfo("lecturer-assistant-v2", version, "BOOTSTRAPPED");
    }
}
