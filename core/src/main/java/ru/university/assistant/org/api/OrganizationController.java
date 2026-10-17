package ru.university.assistant.org.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.api.OrganizationModels.AssignStaffRequest;
import ru.university.assistant.org.api.OrganizationModels.OrganizationMember;
import ru.university.assistant.org.api.OrganizationModels.OrganizationUnit;
import ru.university.assistant.org.api.OrganizationModels.OrganizationView;
import ru.university.assistant.org.api.OrganizationModels.SaveUnitRequest;
import ru.university.assistant.org.internal.OrganizationService;

@RestController
@RequestMapping("/api/v1/organization")
public class OrganizationController {
    private final OrganizationService organization;

    OrganizationController(OrganizationService organization) {
        this.organization = organization;
    }

    @GetMapping
    public OrganizationView view(@AuthenticationPrincipal AuthenticatedUser user) {
        return organization.view(user);
    }

    @GetMapping("/members")
    public List<OrganizationMember> members(
            @AuthenticationPrincipal AuthenticatedUser user, @RequestParam(required = false) UUID unitId) {
        return organization.members(user, unitId);
    }

    @PostMapping("/units")
    @ResponseStatus(HttpStatus.CREATED)
    public OrganizationUnit create(
            @AuthenticationPrincipal AuthenticatedUser user, @Valid @RequestBody SaveUnitRequest request) {
        return organization.save(user, null, request);
    }

    @PutMapping("/units/{unitId}")
    public OrganizationUnit update(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID unitId,
            @Valid @RequestBody SaveUnitRequest request) {
        return organization.save(user, unitId, request);
    }

    @DeleteMapping("/units/{unitId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID unitId) {
        organization.delete(user, unitId);
    }

    @PostMapping("/members/move")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void moveMembers(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody OrganizationModels.MoveStaffRequest request) {
        organization.moveMembers(user, request);
    }

    @PutMapping("/members/{personId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void assign(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID personId,
            @Valid @RequestBody AssignStaffRequest request) {
        organization.assign(user, personId, request);
    }
}
