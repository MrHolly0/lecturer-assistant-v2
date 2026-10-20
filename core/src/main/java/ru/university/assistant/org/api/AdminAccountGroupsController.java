package ru.university.assistant.org.api;

import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.internal.AccountGroupsService;

@RestController
public class AdminAccountGroupsController {
    private final AccountGroupsService groups;

    AdminAccountGroupsController(AccountGroupsService groups) {
        this.groups = groups;
    }

    @GetMapping("/api/v1/admin/account-groups")
    public List<AccountGroup> groups(@AuthenticationPrincipal AuthenticatedUser user) {
        return groups.list(user);
    }
}
