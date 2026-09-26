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
import ru.university.assistant.iam.internal.AuthTokens;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private static final String REFRESH_COOKIE = "la_refresh";

    private final AuthService authService;
    private final Duration refreshTtl;
    private final boolean refreshCookieSecure;
    private final String adminSetupToken;

    AuthController(
            AuthService authService,
            @Value("${app.security.refresh-token-days}") long refreshTokenDays,
            @Value("${app.security.refresh-cookie-secure:true}") boolean refreshCookieSecure,
            @Value("${app.security.admin-setup-token:}") String adminSetupToken) {
        this.authService = authService;
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
                .header(HttpHeaders.SET_COOKIE, refreshCookie(tokens.refreshToken()).toString())
                .body(tokens.toMaxResponse());
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(
            @CookieValue(name = REFRESH_COOKIE, required = false) String refreshToken) {
        return authenticated(authService.refresh(requireRefreshToken(refreshToken)));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = REFRESH_COOKIE, required = false) String refreshToken) {
        if (refreshToken != null && !refreshToken.isBlank()) {
            authService.logout(refreshToken);
        }
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, expiredRefreshCookie().toString())
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
