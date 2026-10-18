package ru.university.assistant.org.internal;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.org.api.OrganizationModels.OrganizationMember;
import ru.university.assistant.org.api.OrganizationModels.UnitIcon;
import ru.university.assistant.org.api.OrganizationModels.UnitKind;
import ru.university.assistant.org.api.OrganizationModels.UnitRole;

@Repository
class OrganizationRepository {
    private final JdbcClient jdbc;

    OrganizationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    record UnitRow(
            UUID id, UUID parentId, String name, UnitKind kind, UnitIcon icon, int directCount, int totalCount) {}

    record Membership(UUID unitId, UnitRole role) {}

    void lockStructure() {
        jdbc.sql("select pg_advisory_xact_lock(hashtextextended('org:structure', 0))").query().singleRow();
    }

    List<UnitRow> units() {
        return jdbc.sql("""
                        select u.id, u.parent_id, u.name, u.kind, u.icon,
                            (select count(*)::int from org.staff_memberships m
                                where m.unit_id = u.id) as direct_count,
                            (with recursive descendants(id) as (
                                select u.id
                                union all
                                select child.id from org.units child join descendants d on child.parent_id = d.id
                            )
                            select count(*)::int from org.staff_memberships m
                            where m.unit_id in (select id from descendants)) as total_count
                        from org.units u order by lower(u.name), u.id
                        """)
                .query((rs, row) -> new UnitRow(
                        rs.getObject("id", UUID.class), rs.getObject("parent_id", UUID.class),
                        rs.getString("name"), UnitKind.valueOf(rs.getString("kind")),
                        UnitIcon.valueOf(rs.getString("icon")),
                        rs.getInt("direct_count"), rs.getInt("total_count")))
                .list();
    }

    Optional<UnitRow> unit(UUID id) {
        return units().stream().filter(unit -> unit.id().equals(id)).findFirst();
    }

    java.util.Set<UUID> descendants(UUID unitId) {
        return java.util.Set.copyOf(jdbc.sql("""
                        with recursive descendants(id) as (
                            select id from org.units where id = :unitId
                            union
                            select child.id from org.units child join descendants d on child.parent_id = d.id
                        )
                        select id from descendants
                        """)
                .param("unitId", unitId)
                .query((rs, row) -> rs.getObject("id", UUID.class))
                .list());
    }

    Optional<Membership> membership(UUID personId) {
        return jdbc.sql("select unit_id, unit_role from org.staff_memberships where person_id = :personId")
                .param("personId", personId)
                .query((rs, row) -> new Membership(
                        rs.getObject("unit_id", UUID.class), UnitRole.valueOf(rs.getString("unit_role"))))
                .optional();
    }

    Optional<PersonRole> personRole(UUID personId) {
        return jdbc.sql("select role from iam.persons where id = :personId")
                .param("personId", personId).query((rs, row) -> PersonRole.valueOf(rs.getString("role"))).optional();
    }

    List<OrganizationMember> members(UUID unitId) {
        var query = jdbc.sql("""
                        select p.id, p.display_name, p.email, p.role, p.status,
                               m.unit_id, u.name as unit_name, m.unit_role
                        from iam.persons p
                        left join org.staff_memberships m on m.person_id = p.id
                        left join org.units u on u.id = m.unit_id
                        where p.role in ('ADMIN', 'LECTURER', 'ASSISTANT')
                          and (cast(:unitId as uuid) is null or m.unit_id in (
                                with recursive descendants(id) as (
                                    select id from org.units where id = cast(:unitId as uuid)
                                    union
                                    select child.id from org.units child join descendants d on child.parent_id = d.id
                                ) select id from descendants
                          ))
                        order by lower(p.display_name), p.id
                        """).param("unitId", unitId);
        return query.query((rs, row) -> new OrganizationMember(
                        rs.getObject("id", UUID.class), rs.getString("display_name"), rs.getString("email"),
                        PersonRole.valueOf(rs.getString("role")), PersonStatus.valueOf(rs.getString("status")),
                        rs.getObject("unit_id", UUID.class), rs.getString("unit_name"),
                        rs.getString("unit_role") == null ? null : UnitRole.valueOf(rs.getString("unit_role"))))
                .list();
    }

    void save(UUID id, UUID parentId, String name, UnitKind kind, UnitIcon icon) {
        jdbc.sql("""
                        insert into org.units(id, parent_id, name, kind, icon)
                        values (:id, :parentId, :name, :kind, :icon)
                        on conflict (id) do update set parent_id = excluded.parent_id, name = excluded.name,
                            icon = excluded.icon
                        """)
                .param("id", id).param("parentId", parentId).param("name", name)
                .param("kind", kind.name()).param("icon", icon.name()).update();
    }

    void delete(UUID unitId) {
        jdbc.sql("delete from org.units where id = :id").param("id", unitId).update();
    }

    void assign(UUID personId, UUID unitId, UnitRole role) {
        if (unitId == null) {
            jdbc.sql("delete from org.staff_memberships where person_id = :personId")
                    .param("personId", personId).update();
            return;
        }
        jdbc.sql("""
                        insert into org.staff_memberships(person_id, unit_id, unit_role)
                        values (:personId, :unitId, :role)
                        on conflict (person_id) do update set unit_id = excluded.unit_id,
                            unit_role = excluded.unit_role, assigned_at = now()
                        """)
                .param("personId", personId).param("unitId", unitId).param("role", role.name()).update();
    }
}
