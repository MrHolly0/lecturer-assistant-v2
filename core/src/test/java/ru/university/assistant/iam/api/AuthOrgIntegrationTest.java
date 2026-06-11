package ru.university.assistant.iam.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
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

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("app.security.jwt-secret", () -> "integration-test-secret-with-enough-length");
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

    private String bootstrapAdmin() throws Exception {
        String body = """
                {"displayName":"Admin","email":"admin@example.test","password":"password-123"}
                """;
        return tokenFrom(mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    }

    private String createAdminInvitation(String token, String role) throws Exception {
        String response = mockMvc.perform(post("/api/v1/admin/invitations")
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response).get("code").asText();
    }

    private String register(String inviteCode, String displayName, String email) throws Exception {
        String body = """
                {"invitationCode":"%s","displayName":"%s","email":"%s","password":"password-123"}
                """
                .formatted(inviteCode, displayName, email);
        return tokenFrom(mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
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

    private String tokenFrom(String response) throws Exception {
        JsonNode json = objectMapper.readTree(response);
        return json.get("accessToken").asText();
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }
}
