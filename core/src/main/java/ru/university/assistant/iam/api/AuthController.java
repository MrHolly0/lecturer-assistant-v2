package ru.university.assistant.iam.api;

import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.internal.AuthService;
import ru.university.assistant.iam.internal.MaxLinkService;
import ru.university.assistant.iam.internal.AuthTokens;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private static final String REFRESH_COOKIE = "la_refresh";
    private static final String MAX_REFRESH_COOKIE = "la_max_refresh";

    private final AuthService authService;
    private final MaxLinkService maxLinks;
    private final Duration refreshTtl;
    private final boolean refreshCookieSecure;
    private final String adminSetupToken;

    AuthController(
            AuthService authService, MaxLinkService maxLinks,
            @Value("${app.security.refresh-token-days}") long refreshTokenDays,
            @Value("${app.security.refresh-cookie-secure:true}") boolean refreshCookieSecure,
            @Value("${app.security.admin-setup-token:}") String adminSetupToken) {
        this.authService = authService;
        this.maxLinks = maxLinks;
        this.refreshTtl = Duration.ofDays(refreshTokenDays);
        this.refreshCookieSecure = refreshCookieSecure;
        this.adminSetupToken = adminSetupToken;
    }

    @PostMapping("/bootstrap-admin")
    public ResponseEntity<AuthResponse> bootstrapAdmin(
            @RequestHeader(name = "X-Admin-Setup-Token", required = false) String setupToken,
            @Valid @RequestBody RegisterRequest request) {
        if (adminSetupToken.isBlank()
                || adminSetupToken.length() < 32
                || setupToken == null
                || !MessageDigest.isEqual(
                        adminSetupToken.getBytes(StandardCharsets.UTF_8),
                        setupToken.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return authenticated(authService.bootstrapAdmin(request));
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return authenticated(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return authenticated(authService.login(request));
    }

    @PostMapping("/max")
    public ResponseEntity<MaxAuthResponse> loginWithMax(@Valid @RequestBody MaxAuthRequest request) {
        AuthTokens tokens = authService.loginWithMax(
                request.initData(), request.linkCode(), request.startParam(), request.existingOnly());
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, maxRefreshCookie(tokens.refreshToken(), refreshTtl).toString())
                .body(tokens.toMaxResponse());
    }

    @PostMapping("/max/link-preview")
    public MaxLinkPreview previewMaxLink(@Valid @RequestBody MaxLinkPreviewRequest request) {
        return maxLinks.preview(request);
    }

    @PostMapping("/max/link-confirm")
    public ResponseEntity<MaxAuthResponse> confirmMaxLink(@Valid @RequestBody MaxLinkConfirmRequest request) {
        AuthTokens tokens = maxLinks.confirm(request);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, maxRefreshCookie(tokens.refreshToken(), refreshTtl).toString())
                .body(tokens.toMaxResponse());
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(
            @CookieValue(name = REFRESH_COOKIE, required = false) String refreshToken,
            @CookieValue(name = MAX_REFRESH_COOKIE, required = false) String maxRefreshToken,
            @RequestHeader(name = "X-Auth-Channel", defaultValue = "browser") String channel) {
        boolean max = isMaxChannel(channel);
        AuthTokens tokens = authService.refresh(requireRefreshToken(max ? maxRefreshToken : refreshToken));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, (max
                        ? maxRefreshCookie(tokens.refreshToken(), refreshTtl)
                        : refreshCookie(tokens.refreshToken())).toString())
                .body(tokens.toResponse());
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @CookieValue(name = REFRESH_COOKIE, required = false) String refreshToken,
            @CookieValue(name = MAX_REFRESH_COOKIE, required = false) String maxRefreshToken,
            @RequestHeader(name = "X-Auth-Channel", defaultValue = "browser") String channel) {
        boolean max = isMaxChannel(channel);
        String token = max ? maxRefreshToken : refreshToken;
        if (token != null && !token.isBlank()) {
            authService.logout(token);
        }
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, (max
                        ? maxRefreshCookie("", Duration.ZERO) : expiredRefreshCookie()).toString())
                .build();
    }

    @PostMapping("/change-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(
            @AuthenticationPrincipal AuthenticatedUser user, @Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(user, request);
    }

    @GetMapping("/me")
    public UserProfile me(@AuthenticationPrincipal AuthenticatedUser user) {
        return authService.currentUser(user);
    }

    private ResponseEntity<AuthResponse> authenticated(AuthTokens tokens) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie(tokens.refreshToken()).toString())
                .body(tokens.toResponse());
    }

    private String requireRefreshToken(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing refresh token");
        }
        return refreshToken;
    }

    private ResponseCookie refreshCookie(String value) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true)
                .secure(refreshCookieSecure)
                .sameSite("Strict")
                .path("/api/v1/auth")
                .maxAge(refreshTtl)
                .build();
    }

    private boolean isMaxChannel(String channel) {
        if (!"browser".equals(channel) && !"max".equals(channel)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown authentication channel");
        }
        return "max".equals(channel);
    }

    /** The MAX iframe needs its own HttpOnly cookie, isolated from the browser cabinet. */
    private ResponseCookie maxRefreshCookie(String value, Duration ttl) {
        return ResponseCookie.from(MAX_REFRESH_COOKIE, value)
                .httpOnly(true).secure(true).sameSite("None").partitioned(true)
                .path("/api/v1/auth").maxAge(ttl).build();
    }

    private ResponseCookie expiredRefreshCookie() {
        return ResponseCookie.from(REFRESH_COOKIE, "")
                .httpOnly(true)
                .secure(refreshCookieSecure)
                .sameSite("Strict")
                .path("/api/v1/auth")
                .maxAge(Duration.ZERO)
                .build();
    }
}
