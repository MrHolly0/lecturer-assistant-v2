package ru.university.assistant.iam.api;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.internal.IdentityService;

@RestController
@RequestMapping("/api/v1/identity")
public class IdentityController {
    private final IdentityService identityService;

    IdentityController(IdentityService identityService) {
        this.identityService = identityService;
    }

    @PostMapping("/link-codes")
    @ResponseStatus(HttpStatus.CREATED)
    public IdentityLinkCodeResponse createLinkCode(@AuthenticationPrincipal AuthenticatedUser user) {
        return identityService.createLinkCode(user);
    }

    @PostMapping("/max/link-codes")
    @ResponseStatus(HttpStatus.CREATED)
    public IdentityLinkCodeResponse createMaxLinkCode(@AuthenticationPrincipal AuthenticatedUser user) {
        return identityService.createMaxLinkCode(user);
    }

    @GetMapping("/max")
    public MaxIdentityStatus maxStatus(@AuthenticationPrincipal AuthenticatedUser user) {
        return new MaxIdentityStatus(identityService.isMaxLinked(user));
    }

    @DeleteMapping("/max")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unlinkMax(@AuthenticationPrincipal AuthenticatedUser user) {
        identityService.unlinkMax(user);
    }

    public record MaxIdentityStatus(boolean connected) {}

    @PostMapping("/link")
    public ChannelIdentityResponse link(@Valid @RequestBody LinkIdentityRequest request) {
        return identityService.link(request);
    }
}
