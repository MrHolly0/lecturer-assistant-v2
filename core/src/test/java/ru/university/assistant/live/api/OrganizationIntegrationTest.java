package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class OrganizationIntegrationTest extends LiveFlowTestBase {
    @Test
    void administratorMovesNestedGroupsAndDeletingBranchPreservesAccountsAndCourses() throws Exception {
        String faculty = create(adminToken, "Информатика", "FACULTY", null, 201).get("id").asText();
        String other = create(adminToken, "Математика", "FACULTY", null, 201).get("id").asText();
        String department = create(adminToken, "Программная инженерия", "UNIT", faculty, 201)
                .get("id").asText();
        String team = create(adminToken, "Команда", "UNIT", department, 201).get("id").asText();
        String person = personIdOf(lecturerToken);
        assign(adminToken, person, team, "MANAGER", 204);

        JsonNode moved = save(adminToken, department, "Программная инженерия", "UNIT", other, 200);
        assertEquals(other, moved.get("parentId").asText());
        JsonNode members = members(adminToken, team, 200);
        assertEquals(1, members.size());
        assertEquals(person, members.get(0).get("id").asText());
        assertEquals("MANAGER", members.get(0).get("unitRole").asText());

        json(delete("/api/v1/organization/units/{id}", other)
                .header("Authorization", "Bearer " + adminToken), 204);
        assertEquals(1, count("iam.persons where id = '" + person + "'"));
        assertEquals(1, count("org.courses where id = '" + courseId + "'"));
        assertEquals(0, count("org.staff_memberships where person_id = '" + person + "'"));
        assertEquals(0, count("org.units where id = '" + department + "'"));
        assertEquals(0, count("org.units where id = '" + team + "'"));
    }

    @Test
    void facultyManagerCannotReadOrMovePeopleOutsideTheirScopeOrGrantManagement() throws Exception {
        String faculty = create(adminToken, "Факультет А", "UNIT", null, 201).get("id").asText();
        String other = create(adminToken, "Факультет Б", "UNIT", null, 201).get("id").asText();
        assign(adminToken, personIdOf(lecturerToken), faculty, "MANAGER", 204);
        String department = create(lecturerToken, "Кафедра", "UNIT", faculty, 201).get("id").asText();
        String team = create(lecturerToken, "Команда", "UNIT", department, 201).get("id").asText();
        String colleague = createStaff("colleague@example.test");
        assign(adminToken, personIdOf(colleague), team, "MEMBER", 204);
        String unassigned = createStaff("unassigned@example.test");
        assign(lecturerToken, personIdOf(unassigned), team, "MEMBER", 403);
        assertEquals(2, members(lecturerToken, faculty, 200).size());
        assertEquals(1, members(lecturerToken, team, 200).size());
        JsonNode managerView = json(
                get("/api/v1/organization").header("Authorization", "Bearer " + lecturerToken), 200);
        assertTrue(managerView.get("units").findValues("canManage").stream().filter(JsonNode::asBoolean).count() >= 3);
        members(lecturerToken, other, 403);
        assign(lecturerToken, personIdOf(colleague), other, "MEMBER", 403);
        assign(lecturerToken, personIdOf(colleague), department, "MANAGER", 403);
        assign(lecturerToken, personIdOf(lecturerToken), faculty, "MEMBER", 403);
        create(lecturerToken, "Новый факультет", "FACULTY", null, 403);
        json(get("/api/v1/admin/users").header("Authorization", "Bearer " + lecturerToken), 403);

        assign(lecturerToken, personIdOf(colleague), faculty, "MEMBER", 204);
        assign(lecturerToken, personIdOf(colleague), null, "MEMBER", 204);
        assertEquals(1, members(lecturerToken, faculty, 200).size());
    }

    @Test
    void movingDepartmentRevokesAccessOfItsPreviousFacultyManager() throws Exception {
        String faculty = create(adminToken, "Первый факультет", "UNIT", null, 201).get("id").asText();
        String target = create(adminToken, "Второй факультет", "UNIT", null, 201).get("id").asText();
        String department = create(adminToken, "Кафедра", "UNIT", faculty, 201).get("id").asText();
        String team = create(adminToken, "Команда", "UNIT", department, 201).get("id").asText();
        assign(adminToken, personIdOf(lecturerToken), faculty, "MANAGER", 204);
        String colleague = createStaff("moved-colleague@example.test");
        assign(adminToken, personIdOf(colleague), team, "MEMBER", 204);
        assertEquals(1, members(lecturerToken, team, 200).size());
        save(adminToken, department, "Кафедра", "UNIT", target, 200);
        members(lecturerToken, team, 403);
        members(lecturerToken, department, 403);
        assign(lecturerToken, personIdOf(colleague), faculty, "MEMBER", 403);
        save(lecturerToken, department, "Переименование", "UNIT", target, 403);
        assertEquals(1, members(lecturerToken, faculty, 200).size());
    }

    @Test
    void ordinaryStaffAndStudentsCannotModifyOrganization() throws Exception {
        assertEquals(0, json(get("/api/v1/organization/members")
                .header("Authorization", "Bearer " + lecturerToken), 200).size());
        String faculty = create(adminToken, "Факультет", "UNIT", null, 201).get("id").asText();
        String department = create(adminToken, "Кафедра", "UNIT", faculty, 201).get("id").asText();
        assign(adminToken, personIdOf(lecturerToken), department, "MEMBER", 204);
        JsonNode view = json(get("/api/v1/organization")
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertFalse(view.get("administrator").asBoolean());
        assertTrue(view.get("units").findValues("canManage").stream().noneMatch(JsonNode::asBoolean));
        save(lecturerToken, department, "Другое имя", "UNIT", faculty, 403);
        json(delete("/api/v1/organization/units/{id}", department)
                .header("Authorization", "Bearer " + lecturerToken), 403);
        String student = maxLogin(98501);
        json(get("/api/v1/organization").header("Authorization", "Bearer " + student), 403);
        assign(adminToken, personIdOf(student), department, "MEMBER", 400);
    }

    @Test
    void hierarchyRejectsCyclesDuplicateNamesAndKindChanges() throws Exception {
        String faculty = create(adminToken, "Факультет", "UNIT", null, 201).get("id").asText();
        String department = create(adminToken, "Кафедра", "UNIT", faculty, 201).get("id").asText();
        String team = create(adminToken, "Вложенная кафедра", "UNIT", department, 201).get("id").asText();
        create(adminToken, "кафедра", "UNIT", faculty, 409);
        save(adminToken, department, "Кафедра", "UNIT", department, 400);
        save(adminToken, faculty, "Факультет", "UNIT", team, 400);
        save(adminToken, department, "Кафедра", "DEPARTMENT", null, 400);
    }

    @Test
    void recursiveCountsDirectMembersAndRootDirectoryWorkWithoutGroups() throws Exception {
        String school = create(adminToken, "Школа", "UNIT", null, 201).get("id").asText();
        String methodical = create(adminToken, "Методическое объединение", "UNIT", school, 201)
                .get("id").asText();
        String team = create(adminToken, "Команда", "UNIT", methodical, 201).get("id").asText();
        String first = personIdOf(lecturerToken);
        String secondToken = createStaff("nested-member@example.test");
        String second = personIdOf(secondToken);
        assign(adminToken, first, school, "MEMBER", 204);
        assign(adminToken, second, team, "MEMBER", 204);

        JsonNode organization = json(get("/api/v1/organization")
                .header("Authorization", "Bearer " + adminToken), 200);
        JsonNode units = organization.get("units");
        assertEquals(2, findUnit(units, school).get("totalMembersCount").asInt());
        assertEquals(1, findUnit(units, methodical).get("totalMembersCount").asInt());
        assertEquals(1, findUnit(units, school).get("directMembersCount").asInt());
        assertEquals(2, members(adminToken, school, 200).size());
        assertEquals(1, members(adminToken, team, 200).size());

        String unassignedToken = createStaff("root-staff@example.test");
        JsonNode directory = members(adminToken, null, 200);
        assertTrue(containsMember(directory, personIdOf(unassignedToken)));
        assertTrue(directory.findValues("unitId").stream().anyMatch(JsonNode::isNull));
    }

    @Test
    void groupInvitationAssignsMemberAndDeletedTargetBecomesRoot() throws Exception {
        String unit = create(adminToken, "Команда для приглашения", "UNIT", null, 201).get("id").asText();
        JsonNode invite = json(post("/api/v1/admin/invitations").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.createObjectNode()
                        .put("role", "LECTURER")
                        .put("organizationUnitId", unit)
                        .toString()),
                201);
        assertEquals(unit, invite.get("organizationUnitId").asText());
        String invitedToken = register(invite.get("code").asText(), "invited-group@example.test");
        JsonNode invitedMember = members(adminToken, unit, 200).get(0);
        assertEquals(personIdOf(invitedToken), invitedMember.get("id").asText());
        assertEquals("MEMBER", invitedMember.get("unitRole").asText());

        String deletedTarget = create(adminToken, "Удаляемая команда", "UNIT", null, 201).get("id").asText();
        String afterDeleteInvite = json(post("/api/v1/admin/invitations")
                .header("Authorization", "Bearer " + adminToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.createObjectNode().put("role", "ASSISTANT")
                        .put("organizationUnitId", deletedTarget).toString()), 201).get("code").asText();
        json(delete("/api/v1/organization/units/{id}", deletedTarget)
                .header("Authorization", "Bearer " + adminToken), 204);
        String rootToken = register(afterDeleteInvite, "invited-root@example.test");
        JsonNode rootMember = findMember(members(adminToken, null, 200), personIdOf(rootToken));
        assertTrue(rootMember.get("unitId").isNull());
        assertEquals(0, count("org.staff_memberships where person_id = '" + personIdOf(rootToken) + "'"));
    }

    @Test
    void invalidInvitationTargetIsRejectedAndChangingRoleToStudentRemovesMembership() throws Exception {
        String missingUnit = "00000000-0000-0000-0000-000000000001";
        json(post("/api/v1/admin/invitations").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.createObjectNode().put("role", "LECTURER")
                        .put("organizationUnitId", missingUnit).toString()), 404);

        String unit = create(adminToken, "Команда сотрудников", "UNIT", null, 201).get("id").asText();
        String personToken = createStaff("to-student@example.test");
        String personId = personIdOf(personToken);
        assign(adminToken, personId, unit, "MEMBER", 204);
        json(put("/api/v1/admin/users/{personId}/role", personId)
                .header("Authorization", "Bearer " + adminToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"STUDENT\"}"), 200);
        assertEquals(0, count("org.staff_memberships where person_id = '" + personId + "'"));
        assertEquals(0, findUnit(json(get("/api/v1/organization").header("Authorization", "Bearer " + adminToken), 200)
                .get("units"), unit).get("totalMembersCount").asInt());
    }

    @Test
    void concurrentRegistrationConsumesGroupInvitationOnceAndRollsBackLoser() throws Exception {
        String unit = create(adminToken, "Одноразовое приглашение", "UNIT", null, 201).get("id").asText();
        String code = json(post("/api/v1/admin/invitations").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.createObjectNode().put("role", "LECTURER")
                        .put("organizationUnitId", unit).toString()), 201).get("code").asText();
        String firstBody = registrationBody(code, "Race one", "race-one@example.test");
        String secondBody = registrationBody(code, "Race two", "race-two@example.test");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<Integer> first = submitRegistration(executor, ready, start, firstBody);
            Future<Integer> second = submitRegistration(executor, ready, start, secondBody);
            assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS));
            start.countDown();
            int firstStatus = first.get().intValue();
            int secondStatus = second.get().intValue();

            assertTrue((firstStatus == 200 && secondStatus == 400) || (firstStatus == 400 && secondStatus == 200));
        }
        assertEquals(1, count("iam.persons where email in ('race-one@example.test', 'race-two@example.test')"));
        assertEquals(1, count("org.staff_memberships where unit_id = '" + unit + "'"));
        assertEquals(1, count("iam.invitations where code = '" + code + "' and used_at is not null"));
    }

    private Future<Integer> submitRegistration(
            ExecutorService executor, CountDownLatch ready, CountDownLatch start, String body) {
        return executor.submit(() -> {
            ready.countDown();
            if (!start.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
                throw new IllegalStateException("Registration start signal timed out");
            }
            return mockMvc.perform(post("/api/v1/auth/register")
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andReturn().getResponse().getStatus();
        });
    }

    private String registrationBody(String code, String name, String email) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "invitationCode", code, "displayName", name, "email", email, "password", "password-123"));
    }

    private JsonNode findUnit(JsonNode units, String id) {
        for (JsonNode unit : units) {
            if (unit.get("id").asText().equals(id)) {
                return unit;
            }
        }
        throw new AssertionError("Missing organization unit " + id);
    }

    private JsonNode findMember(JsonNode members, String id) {
        for (JsonNode member : members) {
            if (member.get("id").asText().equals(id)) {
                return member;
            }
        }
        throw new AssertionError("Missing organization member " + id);
    }

    private boolean containsMember(JsonNode members, String id) {
        for (JsonNode member : members) {
            if (member.get("id").asText().equals(id)) {
                return true;
            }
        }
        return false;
    }

    private String register(String code, String email) throws Exception {
        return json(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "invitationCode", code, "displayName", "Приглашённый сотрудник",
                        "email", email, "password", "password-123"))), 200).get("accessToken").asText();
    }

    private JsonNode create(String token, String name, String kind, String parentId, int expected) throws Exception {
        return json(post("/api/v1/organization/units").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(unitBody(name, kind, parentId)), expected);
    }

    private JsonNode save(
            String token, String id, String name, String kind, String parentId, int expected) throws Exception {
        return json(put("/api/v1/organization/units/{id}", id).header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(unitBody(name, kind, parentId)), expected);
    }

    private String unitBody(String name, String kind, String parentId) throws Exception {
        var body = objectMapper.createObjectNode().put("name", name).put("kind", kind);
        if (parentId != null) {
            body.put("parentId", parentId);
        }
        return objectMapper.writeValueAsString(body);
    }

    private void assign(String token, String person, String unit, String role, int expected) throws Exception {
        var body = objectMapper.createObjectNode().put("unitRole", role);
        if (unit != null) {
            body.put("unitId", unit);
        }
        json(put("/api/v1/organization/members/{id}", person).header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)), expected);
    }

    private JsonNode members(String token, String unit, int expected) throws Exception {
        var request = get("/api/v1/organization/members").header("Authorization", "Bearer " + token);
        if (unit != null) {
            request.param("unitId", unit);
        }
        return json(request, expected);
    }

    private String createStaff(String email) throws Exception {
        String invite = json(post("/api/v1/admin/invitations").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"role\":\"LECTURER\"}"), 201).get("code").asText();
        return json(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "invitationCode", invite, "displayName", "Второй преподаватель",
                        "email", email, "password", "password-123"))), 200).get("accessToken").asText();
    }
}
