package ru.university.assistant.integration.internal;

import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class IntegrationOutbox {
    private final JdbcClient jdbc;
    private final int maxAttempts;
    private final com.fasterxml.jackson.databind.ObjectMapper json;

    IntegrationOutbox(JdbcClient jdbc, @Value("${app.integration.max-attempts:12}") int maxAttempts,
            com.fasterxml.jackson.databind.ObjectMapper json) {
        this.jdbc = jdbc;
        this.maxAttempts = Math.max(1, maxAttempts);
        this.json = json;
    }

    @Transactional
    public List<Claim> claim(UUID owner, int limit, int leaseSeconds) {
        jdbc.sql("""
                update integration.outbox set status = 'DEAD', claim_token = null, lease_owner = null,
                    lease_until = null, last_error = 'Publisher lease repeatedly expired'
                where id in (select id from integration.outbox where status = 'IN_FLIGHT'
                    and lease_until <= now() and attempts >= :max for update skip locked limit 256)
                """).param("max", maxAttempts).update();
        UUID token = UUID.randomUUID();
        return jdbc.sql("""
                with candidates as (
                    select id from integration.outbox where status in ('QUEUED', 'IN_FLIGHT')
                        and attempts < :max and next_attempt_at <= now()
                        and (lease_until is null or lease_until <= now())
                    order by next_attempt_at, created_at for update skip locked limit :limit
                )
                update integration.outbox o set status = 'IN_FLIGHT', lease_owner = :owner,
                    claim_token = :token, lease_until = now() + make_interval(secs => :lease),
                    attempts = attempts + 1
                from candidates c where o.id = c.id
                returning o.id, o.claim_token, o.payload::text as payload, o.routing_key, o.attempts
                """).param("limit", limit).param("owner", owner).param("token", token)
                .param("lease", leaseSeconds).param("max", maxAttempts)
                .query((rs, row) -> new Claim(rs.getObject("id", UUID.class),
                        rs.getObject("claim_token", UUID.class), rs.getString("routing_key"),
                        rs.getString("payload"), rs.getInt("attempts"))).list();
    }

    @Transactional
    public int acknowledge(List<Ack> acknowledgements) {
        int changed = 0;
        List<java.util.Map<String, UUID>> delivered = acknowledgements.stream().filter(Ack::delivered)
                .map(ack -> java.util.Map.of("id", ack.id(), "token", ack.claimToken())).toList();
        if (!delivered.isEmpty()) {
            String payload;
            try { payload = json.writeValueAsString(delivered); }
            catch (com.fasterxml.jackson.core.JsonProcessingException invalid) {
                throw new IllegalArgumentException("Invalid acknowledgements", invalid);
            }
            // No quota locks on this path: cleanup releases one lane per short transaction.
            changed += jdbc.sql("""
                    update integration.outbox o set status = 'DELIVERED', claim_token = null,
                        lease_owner = null, lease_until = null, last_error = null
                    from jsonb_to_recordset(cast(:acks as jsonb)) as a(id uuid, token uuid)
                    where o.id = a.id and o.claim_token = a.token and o.status = 'IN_FLIGHT'
                    """).param("acks", payload).update();
        }
        for (Ack ack : acknowledgements) {
            if (!ack.delivered()) {
                changed += jdbc.sql("""
                        update integration.outbox set
                            status = case when attempts >= :max then 'DEAD' else 'QUEUED' end,
                            lease_until = null, lease_owner = null, claim_token = null,
                            next_attempt_at = now() + make_interval(secs =>
                                least(60.0, power(2.0, least(attempts, 6))) * (0.5 + random() / 2)),
                            last_error = 'Publish not confirmed'
                        where id = :id and claim_token = :token and status = 'IN_FLIGHT'
                        """).param("max", maxAttempts).param("id", ack.id())
                        .param("token", ack.claimToken()).update();
            }
        }
        return changed;
    }

    public java.util.Map<String, Object> status() {
        return jdbc.sql("""
                select count(*) filter(where status <> 'DELIVERED') as pending,
                    count(*) filter(where status = 'DELIVERED') as cleanup,
                    count(*) filter(where status = 'DEAD') as dead,
                    coalesce(sum(charged_bytes), 0) as bytes,
                    coalesce(extract(epoch from now() - min(created_at)), 0) as oldest_seconds
                from integration.outbox
                """).query((rs, row) -> java.util.Map.<String, Object>of("pending", rs.getLong("pending"),
                        "dead", rs.getLong("dead"), "cleanup", rs.getLong("cleanup"), "bytes", rs.getLong("bytes"),
                        "oldestSeconds", rs.getLong("oldest_seconds"))).single();
    }

    @Transactional
    public int redrive(List<UUID> ids) {
        if (ids.isEmpty()) return 0;
        return jdbc.sql("""
                update integration.outbox set status = 'QUEUED', attempts = 0, last_error = null,
                    next_attempt_at = now() where id in (:ids) and status = 'DEAD'
                """).param("ids", ids).update();
    }

    record Claim(UUID id, UUID claimToken, String routingKey, String payload, int attempts) {}
    record Ack(@jakarta.validation.constraints.NotNull UUID id,
            @jakarta.validation.constraints.NotNull UUID claimToken, boolean delivered) {}
}
