package ru.university.assistant.live.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.shared.api.ServiceAuthentication;

@RestController
class AnalyticsExportController {
    private final ServiceAuthentication authentication;
    private final LectureSummaryService summaries;

    AnalyticsExportController(ServiceAuthentication authentication, LectureSummaryService summaries) {
        this.authentication = authentication; this.summaries = summaries;
    }

    @PostMapping("/internal/v1/analytics/export")
    Map<String, Object> export(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody ExportRequest request) {
        authentication.require("analytics", key);
        return summaries.export(request.sessionId());
    }

    record ExportRequest(@NotNull UUID sessionId) {}
}
