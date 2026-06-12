package ru.university.assistant.iam.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.internal.AuthService;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminUserController {
    private final AuthService authService;

    AdminUserController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/users")
    public List<UserProfile> listUsers() {
        return authService.listUsers();
    }

    @PutMapping("/users/{personId}/role")
    public UserProfile updateRole(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID personId,
            @Valid @RequestBody UpdateUserRoleRequest request) {
        return authService.updateUserRole(user, personId, request);
    }

    @PutMapping("/users/{personId}/status")
    public UserProfile updateStatus(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID personId,
            @Valid @RequestBody UpdateUserStatusRequest request) {
        return authService.updateUserStatus(user, personId, request);
    }

    @PostMapping("/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    public InvitationResponse createInvitation(
            @AuthenticationPrincipal AuthenticatedUser user, @Valid @RequestBody CreateInvitationRequest request) {
        return authService.createAdminInvitation(user, request);
    }
}
