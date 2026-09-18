package ru.university.assistant.live.api;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import ru.university.assistant.content.internal.BlobStorage;
import ru.university.assistant.content.internal.ConvertedSlide;
import ru.university.assistant.content.internal.SlideConversionClient;
import ru.university.assistant.content.internal.SlideConversionResult;
import ru.university.assistant.content.internal.SlideConversionSink;
import ru.university.assistant.content.internal.StoredBlob;
import ru.university.assistant.iam.internal.MaxInitDataSigner;

/** B-04 / D-01 / D-14: участник лекции — это человек, повторный вход не плодит участников и членов курса. */
@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
@Import(StudentIdentityIntegrationTest.FakeConversionConfig.class)
class StudentIdentityIntegrationTest {
    private static final String BOT_TOKEN = "identity-test-bot-token-not-a-secret";
    private static final Path BLOB_ROOT =
            Path.of(System.getProperty("java.io.tmpdir"), "lecturer-assistant-v2-identity-blobs-" + UUID.randomUUID());

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcClient jdbc;

    private String adminToken;
    private String lecturerToken;
    private UUID courseId;
    private UUID sessionId;
    private String joinCode;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("app.security.jwt-secret", () -> "integration-test-secret-with-enough-length");
        registry.add("app.content.blob-root", () -> BLOB_ROOT.toString());
        registry.add("app.max.bot-token", () -> BOT_TOKEN);
    }

    @BeforeEach
    void startLecture() throws Exception {
        jdbc.sql(
                        """
                        truncate table
                            analytics.outbox, analytics.events, qa.questions, feedback.comprehension_signals,
                            live.web_participant_tokens, live.slide_log, live.session_participants, live.sessions,
                            content.attachments, live.lectures, content.slide_notes, content.slides,
                            content.slide_decks, content.import_jobs, iam.channel_identities,
                            iam.identity_link_codes, iam.refresh_tokens, iam.invitations, iam.course_bans,
                            org.group_members, org.study_groups, org.course_members, org.courses, iam.persons
                        restart identity cascade
                        """)
                .update();
        adminToken = json(post("/api/v1/auth/bootstrap-admin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Admin\",\"email\":\"admin@example.test\","
                                + "\"password\":\"password-123\"}"), 200)
                .get("accessToken")
                .asText();
        String invite = json(post("/api/v1/admin/invitations")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"), 201)
                .get("code")
                .asText();
        lecturerToken = json(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"invitationCode\":\"" + invite + "\",\"displayName\":\"Lecturer\","
                                + "\"email\":\"lecturer@example.test\",\"password\":\"password-123\"}"), 200)
                .get("accessToken")
                .asText();
        courseId = UUID.fromString(json(post("/api/v1/courses")
                                .header("Authorization", "Bearer " + lecturerToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Algorithms\"}"), 201)
                        .get("id")
                        .asText());
        byte[] pdf = Files.readAllBytes(Path.of("src/test/resources/golden/content/v1-report.pdf"));
        String jobId = json(multipart("/api/v1/courses/{courseId}/decks", courseId)
                        .file(new MockMultipartFile("title", "", "text/plain", "Deck".getBytes()))
                        .file(new MockMultipartFile("file", "v1-report.pdf", "application/pdf", pdf))
                        .header("Authorization", "Bearer " + lecturerToken), 202)
                .get("id")
                .asText();
        String deckId = null;
        for (int i = 0; i < 50 && deckId == null; i++) {
            JsonNode job = json(get("/api/v1/courses/{courseId}/import-jobs/{jobId}", courseId, jobId)
                    .header("Authorization", "Bearer " + lecturerToken), 200);
            if ("COMPLETED".equals(job.get("status").asText())) {
                deckId = job.get("deckId").asText();
            } else {
                Thread.sleep(100);
            }
        }
        String lectureId = json(post("/api/v1/courses/{courseId}/lectures", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Lecture 1\",\"deckId\":\"" + deckId + "\"}"), 201)
                .get("id")
                .asText();
        JsonNode session = json(post("/api/v1/courses/{courseId}/lectures/{lectureId}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken), 201);
        sessionId = UUID.fromString(session.get("id").asText());
        joinCode = session.get("joinCode").asText();
    }

    @Test
    void anonymousStudentReturningWithTokenIsTheSameParticipantAndNeverEntersCourse() throws Exception {
        JsonNode first = join(null, "{\"displayName\":\"Гость Аня\"}");
        String token = first.get("participantToken").asText();

        JsonNode second = join(null, "{\"participantToken\":\"" + token + "\"}");
        JsonNode third = join(null, "{\"participantToken\":\"" + token + "\"}");

        assertEquals(token, second.get("participantToken").asText());
        assertEquals(first.get("participantId").asText(), third.get("participantId").asText());
        assertEquals(1L, count("iam.persons where status = 'EPHEMERAL'"));
        assertEquals(1L, count("live.session_participants"));
        assertEquals(1L, count("live.web_participant_tokens"));
        assertEquals(0L, count("org.course_members where role = 'STUDENT'"));
        assertEquals(1L, count("analytics.events where verb = 'participant.joined' and payload->>'origin' = 'web'"));
    }

    @Test
    void maxStudentJoiningThreeTimesIsOneParticipantAndOneCourseMember() throws Exception {
        String jwt = maxLogin(101);
        String personId = personIdOf(jwt);

        JsonNode a = join(jwt, "{}");
        join(jwt, "{}");
        JsonNode c = join(jwt, null);

        assertEquals("PROFILE", a.get("identityLevel").asText());
        assertEquals(1L, count("live.session_participants where person_id = '" + personId + "'"));
        assertEquals(1L, count("live.session_participants"));
        assertEquals(1L, count("org.course_members where role = 'STUDENT' and person_id = '" + personId + "'"));
        assertEquals(1L, count("live.web_participant_tokens"));
        assertEquals(1L, count("iam.persons where status = 'ACTIVE' and role = 'STUDENT'"));
        assertEquals(0L, count("iam.persons where status = 'EPHEMERAL'"));
        assertEquals(1L, count("analytics.events where verb = 'participant.joined'"));
        assertEquals(1L, count("analytics.events where verb = 'participant.joined' and payload->>'origin' = 'max'"));
        assertNotEquals(a.get("participantToken").asText(), c.get("participantToken").asText());
    }

    @Test
    void maxStudentActsWithJwtOnlyAndCountsOncePerPerson() throws Exception {
        String jwt = maxLogin(202);

        act("/api/v1/student/sessions/{joinCode}/signals", jwt, "{\"value\":\"GREEN\"}", 200);
        act("/api/v1/student/sessions/{joinCode}/signals", jwt, "{\"value\":\"RED\"}", 200);
        act("/api/v1/student/sessions/{joinCode}/questions", jwt, "{\"text\":\"Почему так?\"}", 201);

        assertEquals(1L, count("live.session_participants"));
        assertEquals(1L, count("feedback.comprehension_signals"));
        assertEquals(1L, count("qa.questions"));
        mockMvc.perform(get("/api/v1/courses/{c}/sessions/{s}/engagement", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signalAggregate.total").value(1))
                .andExpect(jsonPath("$.signalAggregate.red").value(1))
                .andExpect(jsonPath("$.questions", hasSize(1)));
    }

    @Test
    void lecturerJoiningOwnSessionKeepsLecturerRole() throws Exception {
        join(lecturerToken, "{}");

        assertEquals(1L, count("analytics.events where payload->>'origin' = 'web' and verb = 'participant.joined'"));
        assertEquals(1L, count("org.course_members where role = 'LECTURER'"));
        assertEquals(0L, count("org.course_members where role = 'STUDENT'"));
    }

    @Test
    void requestWithoutTokenOrLoginIsUnauthorized() throws Exception {
        act("/api/v1/student/sessions/{joinCode}/signals", null, "{\"value\":\"GREEN\"}", 401);
    }

    @Test
    void guestsAreHiddenFromAdminUserList() throws Exception {
        join(null, "{\"displayName\":\"Гость Аня\"}");
        maxLogin(303);

        mockMvc.perform(get("/api/v1/admin/users").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                // администратор, преподаватель и студент MAX; гость не виден
                .andExpect(jsonPath("$", hasSize(3)));
    }

    @Test
    void cleanupScriptRemovesGuestsFromCoursesAndKeepsRealStudents() throws Exception {
        String jwt = maxLogin(404);
        join(jwt, "{}");
        UUID guest = UUID.randomUUID();
        jdbc.sql("insert into iam.persons (id, display_name, email, password_hash, role, status) "
                        + "values (:id, 'Гость', :email, 'x', 'STUDENT', 'EPHEMERAL')")
                .param("id", guest)
                .param("email", "web-" + guest + "@ephemeral.local")
                .update();
        jdbc.sql("insert into org.course_members (course_id, person_id, role) values (:c, :p, 'STUDENT')")
                .param("c", courseId)
                .param("p", guest)
                .update();

        String script = Files.readString(Path.of("../deploy/sql/cleanup-ephemeral-members.sql"));
        for (int run = 0; run < 2; run++) {
            for (String statement : script.replaceAll("(?m)^--.*$", "").split(";")) {
                if (!statement.isBlank()) {
                    jdbc.sql(statement).update();
                }
            }
        }

        assertEquals(0L, count("org.course_members where person_id = '" + guest + "'"));
        assertEquals(1L, count("org.course_members where role = 'STUDENT'"));
        assertEquals(1L, count("iam.persons where id = '" + guest + "'"));
    }

    private JsonNode join(String jwt, String body) throws Exception {
        MockHttpServletRequestBuilder request =
                post("/api/v1/student/sessions/{joinCode}/join", joinCode).contentType(MediaType.APPLICATION_JSON);
        if (body != null) {
            request.content(body);
        }
        if (jwt != null) {
            request.header("Authorization", "Bearer " + jwt);
        }
        return json(request, 200);
    }

    private void act(String url, String jwt, String body, int expected) throws Exception {
        MockHttpServletRequestBuilder request =
                post(url, joinCode).contentType(MediaType.APPLICATION_JSON).content(body);
        if (jwt != null) {
            request.header("Authorization", "Bearer " + jwt);
        }
        json(request, expected);
    }

    private String maxLogin(long userId) throws Exception {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("auth_date", String.valueOf(Instant.now().getEpochSecond()));
        params.put("user", MaxInitDataSigner.userJson(userId, "Иван", "Петров"));
        String initData = MaxInitDataSigner.sign(BOT_TOKEN, params);
        return json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("initData", initData))), 200)
                .get("accessToken")
                .asText();
    }

    private String personIdOf(String jwt) throws Exception {
        return json(get("/api/v1/auth/me").header("Authorization", "Bearer " + jwt), 200).get("id").asText();
    }

    private long count(String fromAndWhere) {
        return jdbc.sql("select count(*) from " + fromAndWhere).query(Long.class).single();
    }

    private JsonNode json(RequestBuilder request, int expected) throws Exception {
        String body = mockMvc.perform(request)
                .andExpect(status().is(expected))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return body.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(body);
    }

    @TestConfiguration
    static class FakeConversionConfig {
        @Bean
        @Primary
        SlideConversionClient fakeConverter(BlobStorage storage) {
            return (StoredBlob source, String outputPrefix, UUID jobId, SlideConversionSink sink) -> {
                try {
                    byte[] png = java.util.Base64.getDecoder().decode(
                            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/"
                                    + "lQ5yYwAAAABJRU5ErkJggg==");
                    String ref = storage.storeBytes(png, "slide-1.png", "image/png").ref();
                    sink.metadata(1, 1, "RENDERING 0/1", null);
                    sink.slide(new ConvertedSlide(1, ref, "Slide 1", false), 1, 1);
                    return new SlideConversionResult(1, 1, false, null, null);
                } catch (java.io.IOException exception) {
                    throw new IllegalStateException(exception);
                }
            };
        }
    }
}
