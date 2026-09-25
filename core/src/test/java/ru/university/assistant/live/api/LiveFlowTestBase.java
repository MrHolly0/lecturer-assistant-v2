package ru.university.assistant.live.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import ru.university.assistant.content.internal.BlobStorage;
import ru.university.assistant.content.internal.ConvertedSlide;
import ru.university.assistant.content.internal.SlideConversionClient;
import ru.university.assistant.content.internal.SlideConversionResult;
import ru.university.assistant.content.internal.SlideConversionSink;
import ru.university.assistant.content.internal.StoredBlob;
import ru.university.assistant.iam.internal.MaxInitDataSigner;

/** Общая обвязка интеграционных тестов живой лекции: преподаватель, курс, колода, запущенная сессия. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(LiveFlowTestBase.FakeConversionConfig.class)
abstract class LiveFlowTestBase {
    private static final String BOT_TOKEN = "identity-test-bot-token-not-a-secret";
    private static final Path BLOB_ROOT =
            Path.of(System.getProperty("java.io.tmpdir"), "lecturer-assistant-v2-identity-blobs-" + UUID.randomUUID());

    // Один контейнер на весь прогон: Spring кэширует контекст между тестовыми классами.
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcClient jdbc;

    String adminToken;
    String lecturerToken;
    UUID courseId;
    UUID groupId;
    UUID sessionId;
    String joinCode;
    String lectureId;
    String deckId;

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
                            analytics.outbox, analytics.events,
                            interaction.activity_responses, interaction.activity_runs,
                            interaction.activity_definitions, interaction.poll_responses,
                            interaction.quick_polls, interaction.question_bank,
                            qa.questions, feedback.comprehension_signals,
                            live.web_participant_tokens, live.slide_log, live.session_participants,
                            live.session_groups, live.sessions,
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
        deckId = null;
        for (int i = 0; i < 50 && deckId == null; i++) {
            JsonNode job = json(get("/api/v1/courses/{courseId}/import-jobs/{jobId}", courseId, jobId)
                    .header("Authorization", "Bearer " + lecturerToken), 200);
            if ("COMPLETED".equals(job.get("status").asText())) {
                deckId = job.get("deckId").asText();
            } else {
                Thread.sleep(100);
            }
        }
        lectureId = json(post("/api/v1/courses/{courseId}/lectures", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Lecture 1\",\"deckId\":\"" + deckId + "\"}"), 201)
                .get("id")
                .asText();
        JsonNode session = json(post("/api/v1/courses/{courseId}/lectures/{lectureId}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupName\":\"Группа А\"}]}"), 201);
        sessionId = UUID.fromString(session.get("id").asText());
        groupId = UUID.fromString(session.get("groups").get(0).get("id").asText());
        joinCode = session.get("joinCode").asText();
        begin(sessionId);
    }

    /** Запускает ещё одну сессию (по новой лекции той же колоды) и возвращает её JSON. */
    JsonNode startAnotherSession() throws Exception {
        String other = json(post("/api/v1/courses/{courseId}/lectures", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Lecture 2\",\"deckId\":\"" + deckId + "\"}"), 201)
                .get("id")
                .asText();
        JsonNode scheduled = json(post(
                        "/api/v1/courses/{courseId}/lectures/{lectureId}/sessions", courseId, other)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}"), 201);
        return begin(UUID.fromString(scheduled.get("id").asText()));
    }

    JsonNode begin(UUID targetSessionId) throws Exception {
        return json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/begin", courseId, targetSessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    JsonNode join(String jwt, String body) throws Exception {
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

    void act(String url, String jwt, String body, int expected) throws Exception {
        MockHttpServletRequestBuilder request =
                post(url, joinCode).contentType(MediaType.APPLICATION_JSON).content(body);
        if (jwt != null) {
            request.header("Authorization", "Bearer " + jwt);
        }
        json(request, expected);
    }

    String maxLogin(long userId) throws Exception {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("auth_date", String.valueOf(Instant.now().getEpochSecond()));
        params.put("user", MaxInitDataSigner.userJson(userId, "Иван", "Петров"));
        String initData = MaxInitDataSigner.sign(BOT_TOKEN, params);
        return json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "initData", initData, "startParam", joinCode))), 200)
                .get("accessToken")
                .asText();
    }

    String personIdOf(String jwt) throws Exception {
        return json(get("/api/v1/auth/me").header("Authorization", "Bearer " + jwt), 200).get("id").asText();
    }

    long count(String fromAndWhere) {
        return jdbc.sql("select count(*) from " + fromAndWhere).query(Long.class).single();
    }

    JsonNode json(RequestBuilder request, int expected) throws Exception {
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
