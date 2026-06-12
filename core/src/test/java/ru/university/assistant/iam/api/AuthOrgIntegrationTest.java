package ru.university.assistant.iam.api;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
class AuthOrgIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcClient jdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("app.security.jwt-secret", () -> "integration-test-secret-with-enough-length");
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
    void nonAdminCannotAccessAdminEndpoints() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerInvite = createAdminInvitation(adminToken, "LECTURER");
        String lecturerToken = register(lecturerInvite, "Lecturer One", "lecturer1@example.test");

        mockMvc.perform(get("/api/v1/admin/users").header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/admin/invitations")
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"))
                .andExpect(status().isForbidden());
    }

    private String bootstrapAdmin() throws Exception {
        String body = """
                {"displayName":"Admin","email":"admin@example.test","password":"password-123"}
                """;
        return tokenFrom(mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
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

    private record AuthResult(String accessToken, JsonNode user) {}
}
