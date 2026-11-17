package ru.university.assistant.iam.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.InvitationApi.StaffAssignment;
import ru.university.assistant.org.api.OrganizationModels.UnitRole;

@Repository
class InvitationRepository {
    private final JdbcClient jdbc;

    InvitationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    InvitationRecord create(
            UUID id, String code, PersonRole role, UUID courseId, UUID groupId, UUID organizationUnitId,
            UnitRole organizationUnitRole, UUID createdBy, Instant expiresAt) {
        return jdbc.sql(
                        """
                        insert into iam.invitations
                            (id, code, role, course_id, group_id, organization_unit_id, organization_unit_role,
                             created_by, expires_at)
                        values (:id, :code, :role, :courseId, :groupId, :organizationUnitId, :organizationUnitRole,
                                :createdBy, :expiresAt)
                        returning id, code, role, course_id, group_id, organization_unit_id, organization_unit_role,
                                  expires_at
                        """)
                .param("id", id)
                .param("code", code)
                .param("role", role.name())
                .param("courseId", courseId)
                .param("groupId", groupId)
                .param("organizationUnitId", organizationUnitId)
                .param("organizationUnitRole", organizationUnitRole.name())
                .param("createdBy", createdBy)
                .param("expiresAt", Timestamp.from(expiresAt))
                .query(this::mapInvitation)
                .single();
    }

    Optional<InvitationRecord> findUsable(String code) {
        return jdbc.sql(
                        """
                        select id, code, role, course_id, group_id, organization_unit_id,
                               organization_unit_role, expires_at
                        from iam.invitations
                        where code = :code and used_at is null and expires_at > now()
                        """)
                .param("code", code)
                .query(this::mapInvitation)
                .optional();
    }

    Optional<StaffAssignment> staffAssignment(UUID invitationId) {
        return jdbc.sql("""
                        select organization_unit_id, organization_unit_role from iam.invitations
                        where id = :invitationId and organization_unit_id is not null
                        """)
                .param("invitationId", invitationId)
                .query((rs, row) -> new StaffAssignment(rs.getObject("organization_unit_id", UUID.class),
                        UnitRole.valueOf(rs.getString("organization_unit_role"))))
                .optional();
    }

    boolean markUsed(UUID id) {
        return jdbc.sql("""
                        update iam.invitations set used_at = now()
                        where id = :id and used_at is null and expires_at > now()
                        """)
                .param("id", id)
                .update() == 1;
    }

    private InvitationRecord mapInvitation(ResultSet resultSet, int rowNumber) throws SQLException {
        return new InvitationRecord(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("code"),
                PersonRole.valueOf(resultSet.getString("role")),
                resultSet.getObject("course_id", UUID.class),
                resultSet.getObject("group_id", UUID.class),
                resultSet.getObject("organization_unit_id", UUID.class),
                UnitRole.valueOf(resultSet.getString("organization_unit_role")),
                resultSet.getTimestamp("expires_at").toInstant());
    }
}
