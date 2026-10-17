package ru.university.assistant.iam.internal;

import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;

@Service
class AccountStateService implements AccountStateApi {
    private final JdbcClient jdbc;

    AccountStateService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<State> find(UUID personId) {
        return jdbc.sql("""
                        select id, display_name, email, role, status, auth_version from iam.persons where id = :id
                        """)
                .param("id", personId)
                .query((rs, row) -> new State(rs.getObject("id", UUID.class), rs.getString("display_name"),
                        rs.getString("email"), PersonRole.valueOf(rs.getString("role")),
                        PersonStatus.valueOf(rs.getString("status")), rs.getLong("auth_version")))
                .optional();
    }

    @Override
    public Set<UUID> enabledPeople(Set<UUID> personIds) {
        if (personIds.isEmpty()) return Set.of();
        return new HashSet<>(jdbc.sql("""
                        select id from iam.persons where id in (:ids) and status in ('ACTIVE', 'EPHEMERAL')
                        """)
                .param("ids", personIds).query(UUID.class).list());
    }
}
