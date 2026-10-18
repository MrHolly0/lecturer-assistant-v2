package ru.university.assistant.iam.api;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.sql.Connection;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
class AuthOrgIntegrationTest {
    private static final String ADMIN_SETUP_TOKEN = "integration-admin-setup-token-with-enough-length";
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    DataSource dataSource;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("app.security.jwt-secret", () -> "integration-test-secret-with-enough-length");
        registry.add("app.security.admin-setup-token", () -> ADMIN_SETUP_TOKEN);
    }

    @BeforeEach
    void resetDatabase() {
        jdbc.sql(
                        """
                        truncate table
                            analytics.outbox,
                            analytics.events,
                            live.slide_log,
                            live.session_participants,
                            live.session_groups,
                            live.sessions,
                            content.attachments,
                            live.lectures,
                            content.slide_notes,
                            content.slides,
                            content.slide_decks,
                            content.import_jobs,
                            iam.channel_identities,
                            iam.identity_link_codes,
                            iam.refresh_tokens,
                            iam.invitations,
                            iam.course_bans,
                            org.group_members,
                            org.study_groups,
                            org.course_members,
                            org.courses,
                            iam.persons
                        restart identity cascade
                        """)
                .update();
    }

    @Test
    void adminSetupRequiresOperatorTokenAndAllowsStudentToArriveFirst() throws Exception {
        String body = """
                {"displayName":"Admin","email":"admin@example.test","password":"password-123"}
                """;
        mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                        .header("X-Admin-Setup-Token", "wrong-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNotFound());

        jdbc.sql("""
                        insert into iam.persons (id, display_name, email, password_hash, role, status)
                        values (:id, 'First MAX student', 'max-123@max.local', 'unused', 'STUDENT', 'ACTIVE')
                        """)
                .param("id", UUID.randomUUID())
                .update();

        mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                        .header("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.role").value("ADMIN"));
        mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                        .header("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isConflict());
    }

    @Test
    void lecturerRegistersCreatesCourseAndForeignLecturerCannotReadIt() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        String lecturerToken = register(lecturerInvite, "Lecturer One", "lecturer1@example.test");

        UUID courseId = createCourse(lecturerToken, "Algorithms");
        UUID groupId = createGroup(lecturerToken, courseId, "BVT-21-1");
        String studentInvite = createCourseInvitation(lecturerToken, courseId, groupId, "STUDENT");
        String studentToken = register(studentInvite, "Student One", "student1@example.test");

        mockMvc.perform(get("/api/v1/courses/{courseId}", courseId)
                        .header("Authorization", bearer(studentToken)))
                .andExpect(status().isOk());

        String otherLecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        String otherLecturerToken = register(otherLecturerInvite, "Lecturer Two", "lecturer2@example.test");

        mockMvc.perform(get("/api/v1/courses/{courseId}", courseId)
                        .header("Authorization", bearer(otherLecturerToken)))
                .andExpect(status().isForbidden());
    }

    @Test
    void expiredAndAlreadyUsedInvitationsAreRejected() throws Exception {
        String adminToken = bootstrapAdmin();
        String expiredInvite = createAdminInvitation(adminToken, "LECTURER", 1);
        expireInvitation(expiredInvite);

        registerExpecting(expiredInvite, "Late Lecturer", "late@example.test", 400);

        String invite = createAdminInvitation(adminToken, "LECTURER");
        register(invite, "Lecturer One", "lecturer1@example.test");

        registerExpecting(invite, "Lecturer Duplicate", "lecturer-duplicate@example.test", 400);
    }

    @Test
    void identityLinkCodeCanBeUsedOnlyOnce() throws Exception {
        String adminToken = bootstrapAdmin();
        String invite = createAdminInvitation(adminToken, "LECTURER");
        String lecturerToken = register(invite, "Lecturer One", "lecturer1@example.test");

        String linkCode = createIdentityLinkCode(lecturerToken);

        mockMvc.perform(post("/api/v1/identity/link")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"code":"%s","channelType":"telegram","externalId":"tg-100","displayHint":"@lecturer"}
                                """
                                        .formatted(linkCode)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.channelType").value("telegram"))
                .andExpect(jsonPath("$.externalId").value("tg-100"));

        mockMvc.perform(post("/api/v1/identity/link")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"code":"%s","channelType":"telegram","externalId":"tg-101","displayHint":"@again"}
                                """
                                        .formatted(linkCode)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void courseGroupsAndBansAreScopedToManagers() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        String lecturerToken = register(lecturerInvite, "Lecturer One", "lecturer1@example.test");
        UUID courseId = createCourse(lecturerToken, "Algorithms");
        UUID groupId = createGroup(lecturerToken, courseId, "BVT-21-1");

        String studentInvite = createCourseInvitation(lecturerToken, courseId, groupId, "STUDENT");
        AuthResult student = registerWithProfile(studentInvite, "Student One", "student1@example.test");

        mockMvc.perform(get("/api/v1/courses/{courseId}/groups", courseId)
                        .header("Authorization", bearer(student.accessToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id").value(groupId.toString()));

        mockMvc.perform(post("/api/v1/courses/{courseId}/groups", courseId)
                        .header("Authorization", bearer(student.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Forbidden\"}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/courses/{courseId}/invitations", courseId)
                        .header("Authorization", bearer(student.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"STUDENT\"}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/courses/{courseId}/bans", courseId)
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"personId":"%s","reason":"manual review"}
                                """
                                        .formatted(student.user().get("id").asText())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.personId").value(student.user().get("id").asText()))
                .andExpect(jsonPath("$.reason").value("manual review"));

        mockMvc.perform(get("/api/v1/courses/{courseId}/bans", courseId)
                        .header("Authorization", bearer(student.accessToken())))
                .andExpect(status().isForbidden());
    }

    @Test
    void courseInvitationCannotUseGroupFromAnotherCourse() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        String lecturerToken = register(lecturerInvite, "Lecturer One", "lecturer1@example.test");
        UUID courseId = createCourse(lecturerToken, "Algorithms");
        UUID otherCourseId = createCourse(lecturerToken, "Databases");
        UUID otherCourseGroupId = createGroup(lecturerToken, otherCourseId, "DB-21");

        mockMvc.perform(post("/api/v1/courses/{courseId}/invitations", courseId)
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"role":"STUDENT","groupId":"%s"}
                                """
                                        .formatted(otherCourseGroupId)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void courseMembershipCanBeManaged() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        AuthResult owner = registerWithProfile(lecturerInvite, "Owner Lecturer", "owner@example.test");
        String ownerToken = owner.accessToken();
        String ownerId = owner.user().get("id").asText();
        UUID courseId = createCourse(ownerToken, "Algorithms");
        UUID groupId = createGroup(ownerToken, courseId, "BVT-21-1");

        String secondInvite = createCourseInvitation(ownerToken, courseId, groupId, "ASSISTANT");
        AuthResult second = registerWithProfile(secondInvite, "Second Teacher", "second@example.test");
        String secondId = second.user().get("id").asText();
        String studentInvite = createCourseInvitation(ownerToken, courseId, groupId, "STUDENT");
        AuthResult student = registerWithProfile(studentInvite, "Student One", "student@example.test");
        String studentId = student.user().get("id").asText();

        // студент (роль STUDENT) не управляет составом
        mockMvc.perform(delete("/api/v1/courses/{c}/members/{p}", courseId, secondId)
                        .header("Authorization", bearer(student.accessToken())))
                .andExpect(status().isForbidden());

        // сменить роль студента на ассистента
        mockMvc.perform(put("/api/v1/courses/{c}/members/{p}/role", courseId, studentId)
                        .header("Authorization", bearer(ownerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"ASSISTANT\"}"))
                .andExpect(status().isNoContent());

        // владельца удалить нельзя
        mockMvc.perform(delete("/api/v1/courses/{c}/members/{p}", courseId, ownerId)
                        .header("Authorization", bearer(ownerToken)))
                .andExpect(status().isConflict());

        // удалить участника
        mockMvc.perform(delete("/api/v1/courses/{c}/members/{p}", courseId, studentId)
                        .header("Authorization", bearer(ownerToken)))
                .andExpect(status().isNoContent());

        // передать владение второму преподавателю
        mockMvc.perform(put("/api/v1/courses/{c}/owner", courseId)
                        .header("Authorization", bearer(ownerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\"}".formatted(secondId)))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/courses/{c}", courseId).header("Authorization", bearer(ownerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerPersonId").value(secondId))
                .andExpect(jsonPath("$.members", hasSize(2)));
    }

    @Test
    void courseManagersCanFindAndAddAnExistingAccountByExactEmail() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult owner = registerWithProfile(createAdminInvitation(admin, "LECTURER"),
                "Owner Lecturer", "owner@example.test");
        UUID courseId = createCourse(owner.accessToken(), "Algorithms");
        UUID groupId = createGroup(owner.accessToken(), courseId, "BVT-21-1");
        UUID otherCourseId = createCourse(owner.accessToken(), "Databases");
        UUID foreignGroupId = createGroup(owner.accessToken(), otherCourseId, "DB-21");
        UUID studentId = UUID.randomUUID();
        insertUser(studentId, "Existing Student", "existing.student@example.test", "STUDENT", "ACTIVE", 1);
        AuthResult existingLecturer = registerWithProfile(createAdminInvitation(admin, "LECTURER"),
                "Existing Lecturer", "existing.lecturer@example.test");

        JsonNode candidate = json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "  EXISTING.STUDENT@EXAMPLE.TEST "), 200);
        assertEquals(1, candidate.size());
        assertEquals(studentId.toString(), candidate.get(0).get("personId").asText());
        assertEquals("Existing Student", candidate.get(0).get("displayName").asText());
        assertFalse(candidate.get(0).get("alreadyMember").asBoolean());
        assertFalse(candidate.get(0).has("email"));

        assertEquals(0, json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "existing.student+other@example.test"), 200).size());
        json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "not-an-email"), 400);

        JsonNode added = json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\",\"groupId\":\"%s\"}"
                                .formatted(studentId, groupId)),
                201);
        assertEquals(courseId.toString(), added.get("courseId").asText());
        assertEquals(studentId.toString(), added.get("personId").asText());
        assertEquals("STUDENT", added.get("role").asText());
        assertEquals(1, count("org.group_members where group_id = '" + groupId + "' and person_id = '"
                + studentId + "'"));

        assertTrue(json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "existing.student@example.test"), 200)
                .get(0).get("alreadyMember").asBoolean());
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"ASSISTANT\"}".formatted(studentId)),
                409);
        assertEquals(1, count("org.group_members where group_id = '" + groupId + "' and person_id = '"
                + studentId + "'"), "duplicate add must not clear existing group membership");
        JsonNode courseMembers = json(get("/api/v1/courses/{c}", courseId)
                .header("Authorization", bearer(owner.accessToken())), 200).get("members");
        String savedRole = null;
        for (JsonNode member : courseMembers) {
            if (studentId.toString().equals(member.get("personId").asText())) savedRole = member.get("role").asText();
        }
        assertEquals("STUDENT", savedRole);

        String lecturerId = existingLecturer.user().get("id").asText();
        JsonNode lecturerAddedAsStudent = json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(lecturerId)),
                201);
        assertEquals("STUDENT", lecturerAddedAsStudent.get("role").asText());
        assertEquals("LECTURER", jdbc.sql("select role from iam.persons where id = :id")
                .param("id", UUID.fromString(lecturerId)).query(String.class).single());

        String ownerId = owner.user().get("id").asText();
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"ASSISTANT\"}".formatted(ownerId)),
                409);
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"LECTURER\",\"groupId\":\"%s\"}"
                                .formatted(UUID.randomUUID(), groupId)),
                400);
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\",\"groupId\":\"%s\"}"
                                .formatted(UUID.randomUUID(), foreignGroupId)),
                400);
    }

    @Test
    void readdingCourseMemberClearsOnlyStaleGroupsFromThatCourse() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult owner = registerWithProfile(createAdminInvitation(admin, "LECTURER"),
                "Owner Lecturer", "readd.owner@example.test");
        UUID courseId = createCourse(owner.accessToken(), "Algorithms");
        UUID groupA = createGroup(owner.accessToken(), courseId, "BVT-21-A");
        UUID groupB = createGroup(owner.accessToken(), courseId, "BVT-21-B");
        UUID otherCourseId = createCourse(owner.accessToken(), "Databases");
        UUID foreignGroup = createGroup(owner.accessToken(), otherCourseId, "DB-21");
        UUID studentId = UUID.randomUUID();
        insertUser(studentId, "Readded Student", "readded.student@example.test", "STUDENT", "ACTIVE", 1);

        mockMvc.perform(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\",\"groupId\":\"%s\"}"
                                .formatted(studentId, groupA)))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/api/v1/courses/{c}/members", otherCourseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\",\"groupId\":\"%s\"}"
                                .formatted(studentId, foreignGroup)))
                .andExpect(status().isCreated());

        mockMvc.perform(delete("/api/v1/courses/{c}/members/{p}", courseId, studentId)
                        .header("Authorization", bearer(owner.accessToken())))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(studentId)))
                .andExpect(status().isCreated());
        assertEquals(0, count("org.group_members gm join org.study_groups g on g.id = gm.group_id"
                + " where g.course_id = '" + courseId + "' and gm.person_id = '" + studentId + "'"));
        assertEquals(1, count("org.group_members where group_id = '" + foreignGroup + "' and person_id = '"
                + studentId + "'"), "groups in other courses must be preserved");

        mockMvc.perform(delete("/api/v1/courses/{c}/members/{p}", courseId, studentId)
                        .header("Authorization", bearer(owner.accessToken())))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\",\"groupId\":\"%s\"}"
                                .formatted(studentId, groupB)))
                .andExpect(status().isCreated());
        assertEquals(1, count("org.group_members gm join org.study_groups g on g.id = gm.group_id"
                + " where g.course_id = '" + courseId + "' and gm.person_id = '" + studentId + "'"));
        assertEquals(1, count("org.group_members where group_id = '" + groupB + "' and person_id = '"
                + studentId + "'"));
        assertEquals(0, count("org.group_members where group_id = '" + groupA + "' and person_id = '"
                + studentId + "'"));

        mockMvc.perform(delete("/api/v1/courses/{c}/members/{p}", courseId, studentId)
                        .header("Authorization", bearer(owner.accessToken())))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"ASSISTANT\"}".formatted(studentId)))
                .andExpect(status().isCreated());
        assertEquals(0, count("org.group_members gm join org.study_groups g on g.id = gm.group_id"
                + " where g.course_id = '" + courseId + "' and gm.person_id = '" + studentId + "'"),
                "re-adding staff must clear stale student group links from this course");
        assertEquals(1, count("org.group_members where group_id = '" + foreignGroup + "' and person_id = '"
                + studentId + "'"), "re-adding must not touch memberships in another course");
    }

    @Test
    void courseMemberLookupAndAddRespectCourseAndAccountAccess() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult owner = registerWithProfile(createAdminInvitation(admin, "LECTURER"),
                "Owner Lecturer", "owner@example.test");
        UUID courseId = createCourse(owner.accessToken(), "Algorithms");
        UUID courseGroupId = createGroup(owner.accessToken(), courseId, "BVT-21-1");
        AuthResult foreignOwner = registerWithProfile(createAdminInvitation(admin, "LECTURER"),
                "Foreign Lecturer", "foreign.lecturer@example.test");
        UUID foreignCourseId = createCourse(foreignOwner.accessToken(), "Databases");
        AuthResult student = registerWithProfile(
                createCourseInvitation(owner.accessToken(), courseId, courseGroupId, "STUDENT"),
                "Course Student", "course.student@example.test");
        UUID otherStudentUuid = UUID.randomUUID();
        insertUser(otherStudentUuid, "Other Student", "other.student@example.test", "STUDENT", "ACTIVE", 1);
        String otherStudentId = otherStudentUuid.toString();
        UUID bannedStudentUuid = UUID.randomUUID();
        insertUser(bannedStudentUuid, "Banned Student", "banned.student@example.test", "STUDENT", "ACTIVE", 1);
        String bannedStudentId = bannedStudentUuid.toString();

        json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(student.accessToken()))
                .param("email", "other.student@example.test"), 403);
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(student.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(otherStudentId)),
                403);
        json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "other.student@example.test"), 200);
        json(post("/api/v1/courses/{c}/members", foreignCourseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(otherStudentId)),
                403);

        json(post("/api/v1/courses/{c}/bans", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\"}".formatted(bannedStudentId)),
                201);
        assertEquals(0, json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "banned.student@example.test"), 200).size());
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(bannedStudentId)),
                403);

        jdbc.sql("update iam.persons set status = 'DISABLED' where id = :id")
                .param("id", UUID.fromString(otherStudentId)).update();
        assertEquals(0, json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "other.student@example.test"), 200).size());
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(otherStudentId)),
                404);

        UUID ephemeralId = UUID.randomUUID();
        jdbc.sql("""
                        insert into iam.persons(id, display_name, email, password_hash, role, status)
                        values (:id, 'Ephemeral', 'ephemeral@example.test', 'hash', 'STUDENT', 'EPHEMERAL')
                        """).param("id", ephemeralId).update();
        assertEquals(0, json(get("/api/v1/courses/{c}/member-candidates", courseId)
                .header("Authorization", bearer(owner.accessToken()))
                .param("email", "ephemeral@example.test"), 200).size());
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(ephemeralId)),
                404);
        json(get("/api/v1/courses/{c}/member-candidates", UUID.randomUUID())
                .header("Authorization", bearer(admin))
                .param("email", "nobody@example.test"), 404);
        json(delete("/api/v1/courses/{c}", courseId)
                .header("Authorization", bearer(owner.accessToken())), 204);
        json(post("/api/v1/courses/{c}/members", courseId)
                        .header("Authorization", bearer(owner.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(ephemeralId)),
                409);
    }

    @Test
    void addingMemberLocksCourseBeforeWaitingForAccountSoArchiveCannotOvertakeIt() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult owner = registerWithProfile(createAdminInvitation(admin, "LECTURER"),
                "Owner Lecturer", "owner@example.test");
        UUID courseId = createCourse(owner.accessToken(), "Algorithms");
        UUID personId = UUID.randomUUID();
        insertUser(personId, "Concurrent Student", "concurrent.student@example.test", "STUDENT", "ACTIVE", 1);

        try (ExecutorService executor = Executors.newFixedThreadPool(2);
                Connection lockConnection = dataSource.getConnection()) {
            lockConnection.setAutoCommit(false);
            try (var statement = lockConnection.prepareStatement(
                    "select id from iam.persons where id = ? for no key update")) {
                statement.setObject(1, personId);
                try (var result = statement.executeQuery()) {
                    assertTrue(result.next());
                }
            }

            Future<Integer> add = executor.submit(() -> mockMvc.perform(
                            post("/api/v1/courses/{c}/members", courseId)
                                    .header("Authorization", bearer(owner.accessToken()))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"personId\":\"%s\",\"role\":\"STUDENT\"}".formatted(personId)))
                    .andReturn().getResponse().getStatus());
            awaitLockWaiter("%from iam.persons where id%for no key update%", 1);

            Future<Integer> archive = executor.submit(() -> mockMvc.perform(
                            delete("/api/v1/courses/{c}", courseId)
                                    .header("Authorization", bearer(owner.accessToken())))
                    .andReturn().getResponse().getStatus());
            awaitLockWaiter("%update org.courses set archived = true%", 1);

            lockConnection.commit();
            assertEquals(201, add.get(10, TimeUnit.SECONDS));
            assertEquals(204, archive.get(10, TimeUnit.SECONDS));
        }

        assertTrue(jdbc.sql("select archived from org.courses where id = :id")
                .param("id", courseId).query(Boolean.class).single());
        assertEquals(1, count("org.course_members where course_id = '" + courseId + "' and person_id = '"
                + personId + "'"));
    }

    @Test
    void nonAdminCannotAccessAdminEndpoints() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        String lecturerToken = register(lecturerInvite, "Lecturer One", "lecturer1@example.test");

        mockMvc.perform(get("/api/v1/admin/users").header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/admin/users/page").header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/admin/invitations")
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminCanSearchFilterAndPageUsersWithoutReturningEphemeralPeople() throws Exception {
        String adminToken = bootstrapAdmin();
        UUID literalMatchId = UUID.randomUUID();
        UUID wildcardLookalikeId = UUID.randomUUID();
        UUID disabledAssistantId = UUID.randomUUID();
        UUID ephemeralId = UUID.randomUUID();
        insertUser(literalMatchId, "Alice 100%_done", "alice-literal@example.test", "LECTURER", "ACTIVE", 4);
        insertUser(wildcardLookalikeId, "Alice 100XXdone", "alice-lookalike@example.test", "LECTURER", "ACTIVE", 3);
        insertUser(disabledAssistantId, "Bob Assistant", "bob@example.test", "ASSISTANT", "DISABLED", 2);
        insertUser(ephemeralId, "Guest Alice", "guest@example.test", "STUDENT", "EPHEMERAL", 1);

        mockMvc.perform(get("/api/v1/admin/users/page").header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(4))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0))
                .andExpect(jsonPath("$.items", hasSize(4)))
                .andExpect(jsonPath("$.items[*].id").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.hasItem(ephemeralId.toString()))))
                .andExpect(jsonPath("$.items[0].passwordHash").doesNotExist());

        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("q", "100%_")
                        .param("role", "LECTURER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value(literalMatchId.toString()));

        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("role", "ASSISTANT")
                        .param("status", "DISABLED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value(disabledAssistantId.toString()));

        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("limit", "1")
                        .param("offset", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(4))
                .andExpect(jsonPath("$.items", hasSize(1)));
        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("offset", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(4))
                .andExpect(jsonPath("$.items", hasSize(0)));

        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("q", "x".repeat(201)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("status", "EPHEMERAL"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("limit", "0"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("limit", "101"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/admin/users/page")
                        .header("Authorization", bearer(adminToken))
                        .param("offset", "1000001"))
                .andExpect(status().isBadRequest());
    }

    private void insertUser(UUID id, String name, String email, String role, String status, int secondsAgo) {
        jdbc.sql("""
                        insert into iam.persons
                            (id, display_name, email, password_hash, role, status, created_at)
                        values (:id, :name, :email, 'synthetic-test-hash', :role, :status,
                                now() - make_interval(secs => :secondsAgo))
                        """)
                .param("id", id)
                .param("name", name)
                .param("email", email)
                .param("role", role)
                .param("status", status)
                .param("secondsAgo", secondsAgo)
                .update();
    }

    private JsonNode json(RequestBuilder request, int expectedStatus) throws Exception {
        String content = mockMvc.perform(request)
                .andExpect(status().is(expectedStatus))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return content.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(content);
    }

    private long count(String fromAndWhere) {
        return jdbc.sql("select count(*) from " + fromAndWhere).query(Long.class).single();
    }

    @Test
    void accountStatusRoleAndPasswordChangesRevokeExistingAccessAndRefreshTokens() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult disabled = registeredStaff(admin, "Disabled", "disabled@example.test");
        AuthResult demoted = registeredStaff(admin, "Demoted", "demoted@example.test");
        AuthResult passwordChanged = registeredStaff(admin, "Password", "password@example.test");

        updateStatus(admin, disabled, "DISABLED");
        updateRole(admin, demoted, "STUDENT");
        mockMvc.perform(post("/api/v1/auth/change-password")
                        .header("Authorization", bearer(passwordChanged.accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"password-123\",\"newPassword\":\"password-456\"}"))
                .andExpect(status().isNoContent());

        assertRevoked(disabled);
        assertRevoked(demoted);
        assertRevoked(passwordChanged);
    }

    @Test
    void concurrentRefreshRotationAllowsExactlyOneConsumer() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult user = registeredStaff(admin, "Refresh", "refresh-race@example.test");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<Integer> first = submitRefresh(executor, ready, start, user.refreshToken());
            Future<Integer> second = submitRefresh(executor, ready, start, user.refreshToken());
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            int a = first.get(10, TimeUnit.SECONDS);
            int b = second.get(10, TimeUnit.SECONDS);
            assertTrue((a == 200 && b == 401) || (a == 401 && b == 200));
        }
        String personId = user.user().get("id").asText();
        assertEquals(1, jdbc.sql("select count(*) from iam.refresh_tokens "
                        + "where person_id = :personId and revoked_at is null")
                .param("personId", UUID.fromString(personId))
                .query(Long.class).single());
        assertEquals(1, jdbc.sql("select count(*) from iam.refresh_tokens "
                        + "where person_id = :personId and revoked_at is not null")
                .param("personId", UUID.fromString(personId))
                .query(Long.class).single());
    }

    @Test
    void adminRoleChangeQueuedBeforeRefreshRevokesRotationBeforeItCanIssueANewCookie() throws Exception {
        String admin = bootstrapAdmin();
        AuthResult target = registeredStaff(admin, "Credential race", "credential-race@example.test");
        UUID personId = UUID.fromString(target.user().get("id").asText());

        try (ExecutorService executor = Executors.newFixedThreadPool(2);
                Connection lockConnection = dataSource.getConnection()) {
            lockConnection.setAutoCommit(false);
            try (var statement = lockConnection.prepareStatement(
                    "select id from iam.persons where id = ? for no key update")) {
                statement.setObject(1, personId);
                try (var result = statement.executeQuery()) {
                    assertTrue(result.next());
                }
            }

            Future<Integer> roleChange = executor.submit(() -> mockMvc.perform(
                            put("/api/v1/admin/users/{id}/role", personId)
                                    .header("Authorization", bearer(admin))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"role\":\"STUDENT\"}"))
                    .andReturn().getResponse().getStatus());
            awaitLockWaiter("%update iam.persons%role%", 1);

            CountDownLatch refreshStart = new CountDownLatch(1);
            Future<Integer> refresh = submitRefresh(
                    executor, new CountDownLatch(0), refreshStart, target.refreshToken());
            refreshStart.countDown();
            awaitLockWaiter("%for no key update%", 1);

            lockConnection.commit();
            assertEquals(200, roleChange.get(10, TimeUnit.SECONDS));
            assertEquals(401, refresh.get(10, TimeUnit.SECONDS));
        }

        assertEquals(0L, jdbc.sql("select count(*) from iam.refresh_tokens "
                        + "where person_id = :personId and revoked_at is null")
                .param("personId", personId).query(Long.class).single());
    }

    private void awaitLockWaiter(String queryPattern, int minimum) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(6);
        while (System.nanoTime() < deadline) {
            long waiters = jdbc.sql("""
                            select count(*) from pg_stat_activity
                            where datname = current_database()
                              and wait_event_type = 'Lock'
                              and lower(query) like lower(:queryPattern)
                            """)
                    .param("queryPattern", queryPattern)
                    .query(Long.class).single();
            if (waiters >= minimum) return;
            Thread.sleep(15);
        }
        throw new AssertionError("Timed out waiting for PostgreSQL lock waiter matching " + queryPattern);
    }

    private AuthResult registeredStaff(String adminToken, String name, String email) throws Exception {
        String invite = createAdminInvitation(adminToken, "LECTURER");
        var response = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"invitationCode\":\"%s\",\"displayName\":\"%s\",\"email\":\"%s\","
                                + "\"password\":\"password-123\"}")
                                .formatted(invite, name, email)))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        JsonNode body = objectMapper.readTree(response.getContentAsString());
        String cookie = response.getHeader(HttpHeaders.SET_COOKIE);
        String refreshToken = cookie.substring("la_refresh=".length(), cookie.indexOf(';'));
        return new AuthResult(body.get("accessToken").asText(), body.get("user"), refreshToken);
    }

    private void updateStatus(String admin, AuthResult user, String status) throws Exception {
        mockMvc.perform(put("/api/v1/admin/users/{id}/status", user.user().get("id").asText())
                        .header("Authorization", bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().isOk());
    }

    private void updateRole(String admin, AuthResult user, String role) throws Exception {
        mockMvc.perform(put("/api/v1/admin/users/{id}/role", user.user().get("id").asText())
                        .header("Authorization", bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"" + role + "\"}"))
                .andExpect(status().isOk());
    }

    private void assertRevoked(AuthResult user) throws Exception {
        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(user.accessToken())))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(new Cookie("la_refresh", user.refreshToken())))
                .andExpect(status().isUnauthorized());
    }

    private Future<Integer> submitRefresh(
            ExecutorService executor, CountDownLatch ready, CountDownLatch start, String refreshToken) {
        return executor.submit(() -> {
            ready.countDown();
            if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Refresh start timed out");
            return mockMvc.perform(post("/api/v1/auth/refresh").cookie(new Cookie("la_refresh", refreshToken)))
                    .andReturn().getResponse().getStatus();
        });
    }

    private String bootstrapAdmin() throws Exception {
        String body = """
                {"displayName":"Admin","email":"admin@example.test","password":"password-123"}
                """;
        return tokenFrom(mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                .header("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
                .andExpect(status().isOk())
                .andExpect(header()
                        .string(
                                HttpHeaders.SET_COOKIE,
                                allOf(
                                        containsString("HttpOnly"),
                                        containsString("Secure"),
                                        containsString("Path=/api/v1/auth"))))
                .andReturn()
                .getResponse()
                .getContentAsString());
    }

    private String createAdminInvitation(String token, String role) throws Exception {
        return createAdminInvitation(token, role, null);
    }

    private String createAdminInvitation(String token, String role, Integer ttlHours) throws Exception {
        String body = ttlHours == null
                ? "{\"role\":\"" + role + "\"}"
                : "{\"role\":\"" + role + "\",\"ttlHours\":" + ttlHours + "}";
        String response = mockMvc.perform(post("/api/v1/admin/invitations")
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response).get("code").asText();
    }

    private String register(String inviteCode, String displayName, String email) throws Exception {
        return registerWithProfile(inviteCode, displayName, email).accessToken();
    }

    private AuthResult registerWithProfile(String inviteCode, String displayName, String email) throws Exception {
        String body = """
                {"invitationCode":"%s","displayName":"%s","email":"%s","password":"password-123"}
                """
                .formatted(inviteCode, displayName, email);
        String response = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode json = objectMapper.readTree(response);
        assertFalse(json.has("refreshToken"));
        return new AuthResult(json.get("accessToken").asText(), json.get("user"));
    }

    private void registerExpecting(String inviteCode, String displayName, String email, int expectedStatus)
            throws Exception {
        String body = """
                {"invitationCode":"%s","displayName":"%s","email":"%s","password":"password-123"}
                """
                .formatted(inviteCode, displayName, email);
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(expectedStatus));
    }

    private UUID createCourse(String token, String title) throws Exception {
        String response = mockMvc.perform(post("/api/v1/courses")
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\"}"))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return UUID.fromString(objectMapper.readTree(response).get("id").asText());
    }

    private UUID createGroup(String token, UUID courseId, String name) throws Exception {
        String response = mockMvc.perform(post("/api/v1/courses/{courseId}/groups", courseId)
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return UUID.fromString(objectMapper.readTree(response).get("id").asText());
    }

    private String createCourseInvitation(String token, UUID courseId, UUID groupId, String role) throws Exception {
        String body = """
                {"role":"%s","groupId":"%s"}
                """
                .formatted(role, groupId);
        String response = mockMvc.perform(post("/api/v1/courses/{courseId}/invitations", courseId)
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response).get("code").asText();
    }

    private String createIdentityLinkCode(String token) throws Exception {
        String response = mockMvc.perform(post("/api/v1/identity/link-codes")
                        .header("Authorization", bearer(token)))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response).get("code").asText();
    }

    private void expireInvitation(String code) {
        jdbc.sql("update iam.invitations set expires_at = now() - interval '1 minute' where code = :code")
                .param("code", code)
                .update();
    }

    private String tokenFrom(String response) throws Exception {
        JsonNode json = objectMapper.readTree(response);
        assertFalse(json.has("refreshToken"));
        return json.get("accessToken").asText();
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private record AuthResult(String accessToken, JsonNode user, String refreshToken) {
        private AuthResult(String accessToken, JsonNode user) { this(accessToken, user, null); }
    }
}
