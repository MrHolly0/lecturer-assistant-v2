package ru.university.assistant.iam.internal.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.TokenAuthenticationApi;

@Service
public class JwtService implements TokenAuthenticationApi {
    private static final String DEVELOPMENT_SECRET = "phase-1-local-development-secret-change-me";
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final byte[] secret;
    private final Duration accessTtl;
    private final AccountStateApi accounts;

    JwtService(
            ObjectMapper objectMapper,
            Clock clock,
            @Value("${app.security.jwt-secret}") String secret,
            @Value("${app.security.access-token-minutes}") long accessTokenMinutes,
            @Value("${app.security.require-strong-secret:false}") boolean requireStrongSecret,
            AccountStateApi accounts) {
        this.accounts = accounts;
        this.objectMapper = objectMapper;
        this.clock = clock;
        validateSecret(secret, requireStrongSecret);
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.accessTtl = Duration.ofMinutes(accessTokenMinutes);
    }

    private void validateSecret(String secret, boolean requireStrongSecret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("JWT_SECRET must not be blank");
        }
        if (requireStrongSecret
                && (DEVELOPMENT_SECRET.equals(secret) || secret.contains("change-me") || secret.length() < 32)) {
            throw new IllegalStateException("JWT_SECRET must be a non-default secret with at least 32 characters");
        }
    }

    public long accessTtlSeconds() {
        return accessTtl.toSeconds();
    }

    public String issue(AuthenticatedUser user) {
        AccountStateApi.State account = accounts.find(user.id()).orElseThrow();
        if (account.status() != PersonStatus.ACTIVE) throw new IllegalStateException("Account is disabled");
        Instant expiresAt = clock.instant().plus(accessTtl);
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> payload = Map.of(
                "sub", user.id().toString(),
                "name", user.displayName(),
                "email", user.email(),
                "role", user.role().name(),
                "ver", account.version(),
                "exp", expiresAt.getEpochSecond());

        String unsigned = encode(header) + "." + encode(payload);
        return unsigned + "." + sign(unsigned);
    }

    public Optional<AuthenticatedUser> parse(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return Optional.empty();
        }

        String unsigned = parts[0] + "." + parts[1];
        if (!constantTimeEquals(sign(unsigned), parts[2])) {
            return Optional.empty();
        }

        try {
            Map<String, Object> payload = objectMapper.readValue(DECODER.decode(parts[1]), MAP_TYPE);
            long expiresAt = ((Number) payload.get("exp")).longValue();
            if (!Instant.ofEpochSecond(expiresAt).isAfter(clock.instant())) {
                return Optional.empty();
            }
            UUID personId = UUID.fromString((String) payload.get("sub"));
            long version = ((Number) payload.get("ver")).longValue();
            return accounts.find(personId)
                    .filter(account -> account.status() == PersonStatus.ACTIVE && account.version() == version)
                    .filter(account -> account.role() == PersonRole.valueOf((String) payload.get("role")))
                    .map(account -> new AuthenticatedUser(
                            account.id(), account.displayName(), account.email(), account.role()));
        } catch (RuntimeException | java.io.IOException exception) {
            return Optional.empty();
        }
    }

    @Override
    public Optional<AuthenticatedUser> parseAccessToken(String token) {
        return parse(token);
    }

    private String encode(Map<String, Object> value) {
        try {
            return ENCODER.encodeToString(objectMapper.writeValueAsBytes(value));
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("Cannot write JWT", exception);
        }
    }

    private String sign(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return ENCODER.encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot sign JWT", exception);
        }
    }

    private boolean constantTimeEquals(String expected, String actual) {
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] actualBytes = actual.getBytes(StandardCharsets.UTF_8);
        return MessageDigestSupport.equals(expectedBytes, actualBytes);
    }
}
