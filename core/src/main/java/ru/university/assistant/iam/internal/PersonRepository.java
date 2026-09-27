package ru.university.assistant.iam.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;

@Repository
class PersonRepository {
    private final JdbcClient jdbc;

    PersonRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    long count() {
        return jdbc.sql("select count(*) from iam.persons").query(Long.class).single();
    }

    void lockAdminBootstrap() {
        jdbc.sql("select pg_advisory_xact_lock(4282026)").query((resultSet, rowNumber) -> 0).single();
    }

    long countAdmins() {
        return jdbc.sql("select count(*) from iam.persons where role = 'ADMIN'")
                .query(Long.class)
                .single();
    }

    PersonRecord create(UUID id, String displayName, String email, String passwordHash, PersonRole role) {
        return jdbc.sql(
                        """
                        insert into iam.persons (id, display_name, email, password_hash, role, status)
                        values (:id, :displayName, lower(:email), :passwordHash, :role, 'ACTIVE')
                        returning id, display_name, email, password_hash, role, status
                        """)
                .param("id", id)
                .param("displayName", displayName)
                .param("email", email)
                .param("passwordHash", passwordHash)
                .param("role", role.name())
                .query(this::mapPerson)
                .single();
    }

    PersonRecord createWithStatus(
            UUID id, String displayName, String email, String passwordHash, PersonRole role, PersonStatus status) {
        return jdbc.sql(
                        """
                        insert into iam.persons (id, display_name, email, password_hash, role, status)
                        values (:id, :displayName, lower(:email), :passwordHash, :role, :status)
                        returning id, display_name, email, password_hash, role, status
                        """)
                .param("id", id)
                .param("displayName", displayName)
                .param("email", email)
                .param("passwordHash", passwordHash)
                .param("role", role.name())
                .param("status", status.name())
                .query(this::mapPerson)
                .single();
    }

    void updateStudentDisplayName(UUID personId, String displayName) {
        jdbc.sql("""
                        update iam.persons set display_name = :displayName
                        where id = :personId and role = 'STUDENT'
                        """)
                .param("personId", personId)
                .param("displayName", displayName)
                .update();
    }

    Optional<PersonRecord> findByEmail(String email) {
        return jdbc.sql(
                        """
                        select id, display_name, email, password_hash, role, status
                        from iam.persons
                        where email = lower(:email)
                        """)
                .param("email", email)
                .query(this::mapPerson)
                .optional();
    }

    Optional<PersonRecord> findById(UUID id) {
        return jdbc.sql(
                        """
                        select id, display_name, email, password_hash, role, status
                        from iam.persons
                        where id = :id
                        """)
                .param("id", id)
                .query(this::mapPerson)
                .optional();
    }

    List<PersonRecord> list() {
        return jdbc.sql(
                        """
                        select id, display_name, email, password_hash, role, status
                        from iam.persons
                        order by created_at desc
                        """)
                .query(this::mapPerson)
                .list();
    }

    void updatePassword(UUID personId, String passwordHash) {
        jdbc.sql(
                        """
                        update iam.persons
                        set password_hash = :passwordHash, updated_at = now()
                        where id = :personId
                        """)
                .param("personId", personId)
                .param("passwordHash", passwordHash)
                .update();
    }

    PersonRecord updateRole(UUID personId, PersonRole role) {
        return jdbc.sql(
                        """
                        update iam.persons
                        set role = :role, updated_at = now()
                        where id = :personId
                        returning id, display_name, email, password_hash, role, status
                        """)
                .param("personId", personId)
                .param("role", role.name())
                .query(this::mapPerson)
                .single();
    }

    PersonRecord updateStatus(UUID personId, PersonStatus status) {
        return jdbc.sql(
                        """
                        update iam.persons
                        set status = :status, updated_at = now()
                        where id = :personId
                        returning id, display_name, email, password_hash, role, status
                        """)
                .param("personId", personId)
                .param("status", status.name())
                .query(this::mapPerson)
                .single();
    }

    private PersonRecord mapPerson(ResultSet resultSet, int rowNumber) throws SQLException {
        return new PersonRecord(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("display_name"),
                resultSet.getString("email"),
                resultSet.getString("password_hash"),
                PersonRole.valueOf(resultSet.getString("role")),
                PersonStatus.valueOf(resultSet.getString("status")));
    }
}
