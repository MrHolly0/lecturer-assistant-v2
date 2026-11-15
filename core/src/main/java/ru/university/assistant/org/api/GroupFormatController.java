package ru.university.assistant.org.api;

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.internal.GroupFormatService;

@RestController
class GroupFormatController {
    private final GroupFormatService service;
    GroupFormatController(GroupFormatService service) { this.service = service; }

    @GetMapping("/api/v1/group-format")
    public GroupFormatPolicy policy() { return service.policy(); }

    @PutMapping("/api/v1/admin/group-format")
    public GroupFormatPolicy save(@AuthenticationPrincipal AuthenticatedUser actor,
            @RequestBody GroupFormatPolicy policy) { return service.save(actor, policy); }

    @PostMapping("/api/v1/group-format/preview")
    public GroupFormatPreview preview(@RequestBody PreviewRequest request) {
        return service.preview(request.name(), request.parts());
    }

    @PostMapping("/api/v1/admin/group-format/reconcile")
    public GroupFormatService.ReconcileResult reconcile(@AuthenticationPrincipal AuthenticatedUser actor,
            @RequestBody ReconcileRequest request) { return service.reconcile(actor, request.revision()); }

    public record PreviewRequest(String name, Map<String, String> parts) {}
    public record ReconcileRequest(long revision) {}
}
