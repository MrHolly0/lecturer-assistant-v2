package ru.university.assistant.shared.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Dedupe and business effects commit together. Failed transactions can be retried with the same key. */
@Service
public class CommandIdempotency {
    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;

    public CommandIdempotency(JdbcClient jdbc, TransactionTemplate transactions, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper.copy().configure(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY, true)
                .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
    }

    public String hash(Object value) {
        return digest(json(value).getBytes(StandardCharsets.UTF_8));
    }

    public String hashStream(InputStream input) throws IOException {
        MessageDigest hash = sha256();
        try (DigestInputStream stream = new DigestInputStream(input, hash)) {
            stream.transferTo(java.io.OutputStream.nullOutputStream());
        }
        return HexFormat.of().formatHex(hash.digest());
    }

    public <T> T execute(UUID actorId, String operation, String key, String requestHash,
            Class<T> resultType, Supplier<T> command) {
        if (key == null) {
            return command.get();
        }
        if (!key.matches("[\\x21-\\x7e]{1,128}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Idempotency-Key");
        }
        String keyHash = digest(key.getBytes(StandardCharsets.UTF_8));
        return transactions.execute(status -> {
            jdbc.sql("""
                    insert into shared.command_idempotency(actor_id, operation, key_hash, request_hash)
                    values (:actor, :operation, :key, :request) on conflict do nothing
                    """).param("actor", actorId).param("operation", operation).param("key", keyHash)
                    .param("request", requestHash).update();
            var saved = jdbc.sql("""
                    select request_hash, response_json::text as response, expires_at <= now() as expired
                    from shared.command_idempotency where actor_id = :actor and operation = :operation
                        and key_hash = :key for update
                    """).param("actor", actorId).param("operation", operation).param("key", keyHash)
                    .query((rs, row) -> new Saved(rs.getString("request_hash"), rs.getString("response"),
                            rs.getBoolean("expired"))).single();
            if (!saved.expired() && !saved.requestHash().equals(requestHash)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Idempotency-Key was already used for a different request");
            }
            if (!saved.expired() && saved.response() != null) {
                try {
                    return mapper.readValue(saved.response(), resultType);
                } catch (JsonProcessingException exception) {
                    throw new IllegalStateException("Cannot replay command result", exception);
                }
            }
            T result = command.get();
            String response = json(result);
            if (response.getBytes(StandardCharsets.UTF_8).length > 2 * 1024 * 1024) {
                throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Command result exceeds replay limit");
            }
            jdbc.sql("""
                    update shared.command_idempotency set request_hash = :request,
                        response_json = cast(:response as jsonb), created_at = now(),
                        expires_at = now() + interval '24 hours'
                    where actor_id = :actor and operation = :operation and key_hash = :key
                    """).param("actor", actorId).param("operation", operation).param("key", keyHash)
                    .param("request", requestHash).param("response", response).update();
            return result;
        });
    }

    @Scheduled(fixedDelayString = "${app.commands.idempotency-cleanup-delay-ms:3600000}")
    public void cleanExpired() {
        // Bounded cleanup; multiple instances skip each other's locked rows.
        jdbc.sql("""
                delete from shared.command_idempotency where ctid in (
                    select ctid from shared.command_idempotency where expires_at < now()
                    order by expires_at for update skip locked limit 1000)
                """).update();
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Cannot serialize command", exception);
        }
    }

    private static String digest(byte[] bytes) {
        return HexFormat.of().formatHex(sha256().digest(bytes));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private record Saved(String requestHash, String response, boolean expired) {}
}
