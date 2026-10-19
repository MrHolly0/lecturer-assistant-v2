package ru.university.assistant.architecture;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class MigrationUpgradeTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void upgradeFromStaffGroupsPreservesPeopleAndEventHistory() throws Exception {
        migration("23").migrate();
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                var sql = connection.createStatement()) {
            sql.execute("""
                    insert into iam.persons(id, display_name, email, password_hash, role, status)
                    values ('00000000-0000-0000-0000-000000000001', 'Existing teacher',
                        'upgrade@example.test', 'unused', 'LECTURER', 'ACTIVE')
                    """);
            sql.execute("""
                    insert into analytics.events(id, aggregate_type, aggregate_id, verb, actor_person_id,
                        context, payload)
                    values ('00000000-0000-0000-0000-000000000002', 'upgrade',
                        '00000000-0000-0000-0000-000000000001', 'preserved',
                        '00000000-0000-0000-0000-000000000001', '{}', '{}')
                    """);
            sql.execute("""
                    insert into analytics.outbox(id, event_id, status)
                    values ('00000000-0000-0000-0000-000000000003',
                        '00000000-0000-0000-0000-000000000002', 'PENDING')
                    """);
        }
        migration("latest").migrate();
        migration("latest").validate();
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                var sql = connection.createStatement()) {
            for (String table : java.util.List.of("iam.persons", "analytics.events", "analytics.outbox",
                    "analytics.outbox_archive")) {
                try (var rows = sql.executeQuery("select count(*) from " + table)) {
                    rows.next();
                    assertEquals(1, rows.getInt(1), table);
                }
            }
            try (var rows = sql.executeQuery("select auth_version from iam.persons")) {
                rows.next();
                assertEquals(0, rows.getLong(1));
            }
        }
    }

    private Flyway migration(String target) {
        return Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas("shared", "iam", "org", "content", "live", "qa", "feedback",
                        "interaction", "channel", "analytics", "projection")
                .defaultSchema("shared").target(target).load();
    }
}
