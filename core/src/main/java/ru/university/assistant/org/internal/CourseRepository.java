package ru.university.assistant.org.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.org.api.Course;
import ru.university.assistant.org.api.CourseBan;
import ru.university.assistant.org.api.CourseMember;
import ru.university.assistant.org.api.CourseRole;
import ru.university.assistant.org.api.StudyGroup;

@Repository
class CourseRepository {
    private final JdbcClient jdbc;

    CourseRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Course create(UUID id, UUID ownerPersonId, String title) {
        return jdbc.sql(
                        """
                        insert into org.courses (id, owner_person_id, title)
                        values (:id, :ownerPersonId, :title)
                        returning id, owner_person_id, title, archived
                        """)
                .param("id", id)
                .param("ownerPersonId", ownerPersonId)
                .param("title", title)
                .query(this::mapCourse)
                .single();
    }

    Optional<Course> findById(UUID courseId) {
        return jdbc.sql(
                        """
                        select id, owner_person_id, title, archived
                        from org.courses
                        where id = :courseId
                        """)
                .param("courseId", courseId)
                .query(this::mapCourse)
                .optional();
    }

    void archive(UUID courseId) {
        jdbc.sql("update org.courses set archived = true, updated_at = now() where id = :courseId")
                .param("courseId", courseId)
                .update();
    }

    void restore(UUID courseId) {
        jdbc.sql("update org.courses set archived = false, updated_at = now() where id = :courseId")
                .param("courseId", courseId)
                .update();
    }

    void delete(UUID courseId) {
        jdbc.sql("delete from org.courses where id = :courseId")
                .param("courseId", courseId)
                .update();
    }

    List<Course> listForPerson(UUID personId, boolean admin) {
        if (admin) {
            return jdbc.sql("select id, owner_person_id, title, archived from org.courses order by created_at desc")
                    .query(this::mapCourse)
                    .list();
        }
        return jdbc.sql(
                        """
                        select c.id, c.owner_person_id, c.title, c.archived
                        from org.courses c
                        join org.course_members cm on cm.course_id = c.id
                        where cm.person_id = :personId
                        order by c.created_at desc
                        """)
                .param("personId", personId)
                .query(this::mapCourse)
                .list();
    }

    void addMember(UUID courseId, UUID personId, CourseRole role) {
        jdbc.sql(
                        """
                        insert into org.course_members (course_id, person_id, role)
                        values (:courseId, :personId, :role)
                        on conflict (course_id, person_id) do update set role = excluded.role
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .param("role", role.name())
                .update();
    }

    void addMemberIfAbsent(UUID courseId, UUID personId, CourseRole role) {
        jdbc.sql(
                        """
                        insert into org.course_members (course_id, person_id, role)
                        values (:courseId, :personId, :role)
                        on conflict (course_id, person_id) do nothing
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .param("role", role.name())
                .update();
    }

    void removeMember(UUID courseId, UUID personId) {
        jdbc.sql("delete from org.course_members where course_id = :courseId and person_id = :personId")
                .param("courseId", courseId)
                .param("personId", personId)
                .update();
    }

    void updateMemberRole(UUID courseId, UUID personId, CourseRole role) {
        jdbc.sql(
                        """
                        update org.course_members set role = :role
                        where course_id = :courseId and person_id = :personId
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .param("role", role.name())
                .update();
    }

    void updateOwner(UUID courseId, UUID newOwnerPersonId) {
        jdbc.sql("update org.courses set owner_person_id = :owner, updated_at = now() where id = :courseId")
                .param("owner", newOwnerPersonId)
                .param("courseId", courseId)
                .update();
    }

    Optional<CourseRole> findMemberRole(UUID courseId, UUID personId) {
        return jdbc.sql(
                        """
                        select role
                        from org.course_members
                        where course_id = :courseId and person_id = :personId
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .query(String.class)
                .optional()
                .map(CourseRole::valueOf);
    }

    List<CourseMember> listMembers(UUID courseId) {
        return jdbc.sql(
                        """
                        select cm.course_id, cm.person_id, p.display_name, cm.role
                        from org.course_members cm
                        join iam.persons p on p.id = cm.person_id
                        where cm.course_id = :courseId
                        order by cm.joined_at
                        """)
                .param("courseId", courseId)
                .query(this::mapMember)
                .list();
    }

    StudyGroup createGroup(UUID id, UUID courseId, String name) {
        return jdbc.sql(
                        """
                        insert into org.study_groups (id, course_id, name)
                        values (:id, :courseId, :name)
                        returning id, course_id, name
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("name", name)
                .query(this::mapGroup)
                .single();
    }

    StudyGroup getOrCreateGroup(UUID id, UUID courseId, String name) {
        return jdbc.sql(
                        """
                        insert into org.study_groups (id, course_id, name)
                        values (:id, :courseId, :name)
                        on conflict (course_id, name) do update set name = excluded.name
                        returning id, course_id, name
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("name", name)
                .query(this::mapGroup)
                .single();
    }

    Optional<StudyGroup> findGroup(UUID courseId, UUID groupId) {
        return jdbc.sql("select id, course_id, name from org.study_groups where course_id = :courseId and id = :id")
                .param("courseId", courseId)
                .param("id", groupId)
                .query(this::mapGroup)
                .optional();
    }

    List<StudyGroup> listGroups(UUID courseId) {
        return jdbc.sql(
                        """
                        select id, course_id, name
                        from org.study_groups
                        where course_id = :courseId
                        order by name
                        """)
                .param("courseId", courseId)
                .query(this::mapGroup)
                .list();
    }

    boolean groupBelongsToCourse(UUID groupId, UUID courseId) {
        return jdbc.sql("select count(*) from org.study_groups where id = :groupId and course_id = :courseId")
                .param("groupId", groupId)
                .param("courseId", courseId)
                .query(Long.class)
                .single()
                > 0;
    }

    void deleteGroup(UUID groupId) {
        jdbc.sql("delete from org.study_groups where id = :groupId")
                .param("groupId", groupId)
                .update();
    }

    boolean groupUsedBySession(UUID groupId) {
        return jdbc.sql("select count(*) from live.session_groups where group_id = :groupId")
                        .param("groupId", groupId)
                        .query(Long.class)
                        .single()
                > 0;
    }

    void addGroupMember(UUID groupId, UUID personId) {
        jdbc.sql(
                        """
                        insert into org.group_members (group_id, person_id)
                        values (:groupId, :personId)
                        on conflict do nothing
                        """)
                .param("groupId", groupId)
                .param("personId", personId)
                .update();
    }

    CourseRole lockMemberRole(UUID courseId, UUID personId) {
        return jdbc.sql(
                        """
                        select role from org.course_members
                        where course_id = :courseId and person_id = :personId
                        for update
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .query(String.class)
                .optional()
                .map(CourseRole::valueOf)
                .orElseThrow();
    }

    Optional<StudyGroup> findStudentGroup(UUID courseId, UUID personId) {
        return jdbc.sql(
                        """
                        select g.id, g.course_id, g.name
                        from org.group_members gm
                        join org.study_groups g on g.id = gm.group_id
                        where g.course_id = :courseId and gm.person_id = :personId
                        order by gm.joined_at, g.id
                        limit 1
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .query(this::mapGroup)
                .optional();
    }

    List<CourseMember> listGroupMembers(UUID courseId, UUID groupId) {
        return jdbc.sql("""
                        select cm.course_id, cm.person_id, p.display_name, cm.role
                        from org.group_members gm
                        join org.study_groups g on g.id = gm.group_id
                        join org.course_members cm on cm.course_id = g.course_id and cm.person_id = gm.person_id
                        join iam.persons p on p.id = gm.person_id
                        where g.course_id = :courseId and g.id = :groupId
                        order by p.display_name, cm.person_id
                        """)
                .param("courseId", courseId)
                .param("groupId", groupId)
                .query(this::mapMember)
                .list();
    }

    void moveGroupMember(UUID courseId, UUID groupId, UUID personId) {
        jdbc.sql("""
                        delete from org.group_members gm
                        using org.study_groups g
                        where g.id = gm.group_id and g.course_id = :courseId and gm.person_id = :personId
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .update();
        addGroupMember(groupId, personId);
    }

    boolean removeGroupMember(UUID courseId, UUID groupId, UUID personId) {
        return jdbc.sql("""
                        delete from org.group_members gm
                        using org.study_groups g
                        where gm.group_id = g.id and g.course_id = :courseId
                            and g.id = :groupId and gm.person_id = :personId
                        """)
                .param("courseId", courseId)
                .param("groupId", groupId)
                .param("personId", personId)
                .update() > 0;
    }

    CourseBan ban(UUID courseId, UUID personId, String reason, UUID bannedBy) {
        return jdbc.sql(
                        """
                        insert into iam.course_bans (course_id, person_id, reason, banned_by)
                        values (:courseId, :personId, :reason, :bannedBy)
                        on conflict (course_id, person_id) do update set reason = excluded.reason, banned_at = now()
                        returning course_id, person_id, reason, banned_at
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .param("reason", reason)
                .param("bannedBy", bannedBy)
                .query(this::mapBan)
                .single();
    }

    List<CourseBan> listBans(UUID courseId) {
        return jdbc.sql(
                        """
                        select course_id, person_id, reason, banned_at
                        from iam.course_bans
                        where course_id = :courseId
                        order by banned_at desc
                        """)
                .param("courseId", courseId)
                .query(this::mapBan)
                .list();
    }

    private Course mapCourse(ResultSet resultSet, int rowNumber) throws SQLException {
        return new Course(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("title"),
                resultSet.getObject("owner_person_id", UUID.class),
                resultSet.getBoolean("archived"));
    }

    private CourseMember mapMember(ResultSet resultSet, int rowNumber) throws SQLException {
        return new CourseMember(
                resultSet.getObject("course_id", UUID.class),
                resultSet.getObject("person_id", UUID.class),
                resultSet.getString("display_name"),
                CourseRole.valueOf(resultSet.getString("role")));
    }

    private StudyGroup mapGroup(ResultSet resultSet, int rowNumber) throws SQLException {
        return new StudyGroup(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("course_id", UUID.class),
                resultSet.getString("name"));
    }

    private CourseBan mapBan(ResultSet resultSet, int rowNumber) throws SQLException {
        return new CourseBan(
                resultSet.getObject("course_id", UUID.class),
                resultSet.getObject("person_id", UUID.class),
                resultSet.getString("reason"),
                resultSet.getTimestamp("banned_at").toInstant());
    }
}
