package ru.university.assistant.org.internal;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.org.api.AccountGroup;

@Service
public class AccountGroupsService {
    private final JdbcClient jdbc;

    AccountGroupsService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<AccountGroup> list(AuthenticatedUser user) {
        if (user == null || user.role() != PersonRole.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        Map<UUID, List<UUID>> staff = memberships("""
                select m.unit_id as group_id, m.person_id
                from org.staff_memberships m join iam.persons p on p.id = m.person_id
                where p.role in ('LECTURER', 'ASSISTANT') and p.status <> 'EPHEMERAL'
                order by m.unit_id, m.person_id
                """);
        List<AccountGroup> result = new ArrayList<>(jdbc.sql("""
                        select id, parent_id, name, icon from org.units order by lower(name), id
                        """)
                .query((rs, row) -> new AccountGroup(
                        "unit:" + rs.getObject("id", UUID.class),
                        rs.getObject("parent_id") == null ? "staff" : "unit:" + rs.getObject("parent_id", UUID.class),
                        rs.getString("name"), "Группа сотрудников", rs.getString("icon"),
                        staff.getOrDefault(rs.getObject("id", UUID.class), List.of())))
                .list());
        Map<UUID, List<UUID>> students = memberships("""
                select gm.group_id, gm.person_id from org.group_members gm
                join org.study_groups g on g.id = gm.group_id
                join org.course_members cm on cm.course_id = g.course_id and cm.person_id = gm.person_id
                join iam.persons p on p.id = gm.person_id
                where cm.role = 'STUDENT' and p.role = 'STUDENT' and p.status <> 'EPHEMERAL'
                order by gm.group_id, gm.person_id
                """);
        result.addAll(jdbc.sql("""
                        select g.id, g.name, c.title, c.archived from org.study_groups g
                        join org.courses c on c.id = g.course_id
                        order by lower(g.name), c.id, g.id
                        """)
                .query((rs, row) -> new AccountGroup(
                        "group:" + rs.getObject("id", UUID.class), "students", rs.getString("name"),
                        rs.getString("title") + (rs.getBoolean("archived") ? " (архив)" : ""),
                        "GRADUATION", students.getOrDefault(rs.getObject("id", UUID.class), List.of())))
                .list());
        return result;
    }

    private Map<UUID, List<UUID>> memberships(String sql) {
        return jdbc.sql(sql)
                .query((rs, row) -> Map.entry(
                        rs.getObject("group_id", UUID.class), rs.getObject("person_id", UUID.class)))
                .list().stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey,
                        Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
    }
}
