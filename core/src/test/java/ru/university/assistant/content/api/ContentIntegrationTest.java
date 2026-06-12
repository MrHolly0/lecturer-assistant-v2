package ru.university.assistant.content.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import ru.university.assistant.content.internal.BlobStorage;
import ru.university.assistant.content.internal.ConvertedSlide;
import ru.university.assistant.content.internal.SlideConversionResult;
import ru.university.assistant.content.internal.SlideConversionClient;
import ru.university.assistant.content.internal.SlideConversionSink;
import ru.university.assistant.content.internal.StoredBlob;

@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
class ContentIntegrationTest {
    private static final Path BLOB_ROOT =
            Path.of(System.getProperty("java.io.tmpdir"), "lecturer-assistant-v2-test-blobs-" + UUID.randomUUID());

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
        registry.add("app.content.blob-root", () -> BLOB_ROOT.toString());
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
    void realV1PdfImportCreatesProgressDeckCacheHeadersAndSecondVersion() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerToken = register(
                createAdminInvitation(adminToken, "LECTURER"), "Lecturer", "lecturer@example.test");
        UUID courseId = createCourse(lecturerToken, "Algorithms");
        byte[] pdf = Files.readAllBytes(Path.of("src/test/resources/golden/content/v1-report.pdf"));

        JsonNode firstJob = startImport(lecturerToken, courseId, "Golden Deck", pdf);
        JsonNode completedFirst = waitForCompletedJob(lecturerToken, courseId, firstJob.get("id").asText());
        String firstDeckId = completedFirst.get("deckId").asText();

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}", courseId, firstDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Golden Deck"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.slides", hasSize(2)));

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}/slides/1/image", courseId, firstDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("max-age")));

        JsonNode secondJob = startImport(lecturerToken, courseId, "Golden Deck", pdf);
        JsonNode completedSecond = waitForCompletedJob(lecturerToken, courseId, secondJob.get("id").asText());
        String secondDeckId = completedSecond.get("deckId").asText();

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}", courseId, secondDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}", courseId, firstDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void partialImportKeepsRenderedSlidesAvailable() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerToken = register(
                createAdminInvitation(adminToken, "LECTURER"), "Lecturer", "lecturer@example.test");
        UUID courseId = createCourse(lecturerToken, "Algorithms");
        byte[] pdf = Files.readAllBytes(Path.of("src/test/resources/golden/content/v1-report.pdf"));

        JsonNode job = startImport(lecturerToken, courseId, "Partial Deck", "partial-report.pdf", pdf);
        JsonNode partialJob = waitForJobStatus(lecturerToken, courseId, job.get("id").asText(), "PARTIAL");
        String deckId = partialJob.get("deckId").asText();

        assertEquals(1, partialJob.get("processedSlides").asInt());
        assertEquals(3, partialJob.get("totalSlides").asInt());
        assertEquals("Импортировано 1 из 3", partialJob.get("warningMessage").asText());

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}", courseId, deckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Partial Deck"))
                .andExpect(jsonPath("$.slides", hasSize(1)))
                .andExpect(jsonPath("$.slides[0].textExtract", containsString("Слайд 2: ошибка рендера")));
    }

    @Test
    void archivedDeckNameCanBeReusedAndHardDeleteRemovesBlobs() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerToken = register(
                createAdminInvitation(adminToken, "LECTURER"), "Lecturer", "lecturer@example.test");
        UUID courseId = createCourse(lecturerToken, "Algorithms");
        byte[] pdf = Files.readAllBytes(Path.of("src/test/resources/golden/content/v1-report.pdf"));

        String firstDeckId = waitForCompletedJob(lecturerToken, courseId,
                        startImport(lecturerToken, courseId, "Reusable Deck", pdf).get("id").asText())
                .get("deckId")
                .asText();
        List<String> firstBlobRefs = blobRefs(firstDeckId);
        assertFalse(firstBlobRefs.isEmpty());
        for (String ref : firstBlobRefs) {
            assertTrue(Files.exists(BLOB_ROOT.resolve(ref)), "Blob must exist before hard-delete: " + ref);
        }

        mockMvc.perform(delete("/api/v1/courses/{courseId}/decks/{deckId}", courseId, firstDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isNoContent());

        String secondDeckId = waitForCompletedJob(lecturerToken, courseId,
                        startImport(lecturerToken, courseId, "Reusable Deck", pdf).get("id").asText())
                .get("deckId")
                .asText();

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}", courseId, secondDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Reusable Deck"))
                .andExpect(jsonPath("$.version").value(1));

        mockMvc.perform(delete("/api/v1/courses/{courseId}/decks/{deckId}/hard", courseId, firstDeckId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isNoContent());

        for (String ref : firstBlobRefs) {
            assertFalse(Files.exists(BLOB_ROOT.resolve(ref)), "Blob must be deleted: " + ref);
        }
    }

    @Test
    void slideNotesLecturesAttachmentsAndDecksAreCourseScoped() throws Exception {
        String adminToken = bootstrapAdmin();
        String lecturerToken = register(
                createAdminInvitation(adminToken, "LECTURER"), "Lecturer", "lecturer@example.test");
        String foreignToken = register(
                createAdminInvitation(adminToken, "LECTURER"), "Other Lecturer", "other@example.test");
        UUID courseId = createCourse(lecturerToken, "Algorithms");
        byte[] pdf = Files.readAllBytes(Path.of("src/test/resources/golden/content/v1-report.pdf"));
        String deckId = waitForCompletedJob(lecturerToken, courseId,
                        startImport(lecturerToken, courseId, "Lecture Deck", pdf).get("id").asText())
                .get("deckId")
                .asText();

        mockMvc.perform(put("/api/v1/courses/{courseId}/decks/{deckId}/slides/1/notes", courseId, deckId)
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"Проверить пример на слайде\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("Проверить пример на слайде"));

        String lectureResponse = mockMvc.perform(post("/api/v1/courses/{courseId}/lectures", courseId)
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Lecture 1","deckId":"%s"}
                                """
                                .formatted(deckId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Lecture 1"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        String lectureId = objectMapper.readTree(lectureResponse).get("id").asText();

        MockMultipartFile attachment = new MockMultipartFile(
                "file", "notes.txt", "text/plain", "extra material".getBytes());
        mockMvc.perform(multipart("/api/v1/courses/{courseId}/lectures/{lectureId}/attachments", courseId, lectureId)
                        .file(attachment)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.filename").value("notes.txt"));

        mockMvc.perform(get("/api/v1/courses/{courseId}/lectures/{lectureId}", courseId, lectureId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachments", hasSize(1)));

        String sessionResponse = mockMvc.perform(post(
                                "/api/v1/courses/{courseId}/lectures/{lectureId}/sessions", courseId, lectureId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("LIVE"))
                .andExpect(jsonPath("$.currentSlideIdx").value(1))
                .andReturn()
                .getResponse()
                .getContentAsString();
        String sessionId = objectMapper.readTree(sessionResponse).get("id").asText();

        mockMvc.perform(put("/api/v1/courses/{courseId}/sessions/{sessionId}/slide", courseId, sessionId)
                        .header("Authorization", bearer(lecturerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slideIdx\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentSlideIdx").value(2));

        mockMvc.perform(get("/api/v1/courses/{courseId}/sessions/{sessionId}", courseId, sessionId)
                        .header("Authorization", bearer(lecturerToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentSlideIdx").value(2));

        long events = jdbc.sql(
                        """
                        select count(*)
                        from analytics.events
                        where aggregate_id = :sessionId and verb in ('session.started', 'session.slide_changed')
                        """)
                .param("sessionId", UUID.fromString(sessionId))
                .query(Long.class)
                .single();
        assertEquals(2, events);

        mockMvc.perform(get("/api/v1/courses/{courseId}/decks/{deckId}", courseId, deckId)
                        .header("Authorization", bearer(foreignToken)))
                .andExpect(status().isForbidden());
    }

    private JsonNode startImport(String token, UUID courseId, String title, byte[] bytes) throws Exception {
        return startImport(token, courseId, title, "v1-report.pdf", bytes);
    }

    private JsonNode startImport(
            String token, UUID courseId, String title, String filename, byte[] bytes) throws Exception {
        MockMultipartFile titlePart = new MockMultipartFile("title", "", "text/plain", title.getBytes());
        MockMultipartFile filePart = new MockMultipartFile("file", filename, "application/pdf", bytes);
        String response = mockMvc.perform(multipart("/api/v1/courses/{courseId}/decks", courseId)
                        .file(titlePart)
                        .file(filePart)
                        .header("Authorization", bearer(token)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode waitForCompletedJob(String token, UUID courseId, String jobId) throws Exception {
        JsonNode job = waitForJobStatus(token, courseId, jobId, "COMPLETED");
        assertEquals(100, job.get("progressPercent").asInt());
        assertNotNull(job.get("deckId").asText());
        return job;
    }

    private JsonNode waitForJobStatus(String token, UUID courseId, String jobId, String expectedStatus)
            throws Exception {
        JsonNode job = null;
        for (int attempt = 0; attempt < 50; attempt++) {
            String response = mockMvc.perform(get("/api/v1/courses/{courseId}/import-jobs/{jobId}", courseId, jobId)
                            .header("Authorization", bearer(token)))
                    .andExpect(status().isOk())
                    .andReturn()
                    .getResponse()
                    .getContentAsString();
            job = objectMapper.readTree(response);
            if (expectedStatus.equals(job.get("status").asText())) {
                return job;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Import job did not reach " + expectedStatus + ": " + job);
    }

    private String bootstrapAdmin() throws Exception {
        String response = mockMvc.perform(post("/api/v1/auth/bootstrap-admin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Admin","email":"admin@example.test","password":"password-123"}
                                """))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return tokenFrom(response);
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
        String response = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"invitationCode":"%s","displayName":"%s","email":"%s","password":"password-123"}
                                """
                                .formatted(inviteCode, displayName, email)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode json = objectMapper.readTree(response);
        assertFalse(json.has("refreshToken"));
        return json.get("accessToken").asText();
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

    private String tokenFrom(String response) throws Exception {
        return objectMapper.readTree(response).get("accessToken").asText();
    }

    private List<String> blobRefs(String deckId) {
        return jdbc.sql(
                        """
                        select source_file_ref as ref
                        from content.slide_decks
                        where id = :deckId
                        union
                        select image_ref as ref
                        from content.slides
                        where deck_id = :deckId
                        """)
                .param("deckId", UUID.fromString(deckId))
                .query(String.class)
                .list();
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    @TestConfiguration
    static class FakeConversionConfig {
        @Bean
        @Primary
        SlideConversionClient fakeConverter(BlobStorage storage) {
            return new SlideConversionClient() {
                @Override
                public SlideConversionResult convert(
                        StoredBlob source, String outputPrefix, UUID jobId, SlideConversionSink sink) {
                    try {
                        byte[] png = java.util.Base64.getDecoder().decode(
                                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/"
                                        + "lQ5yYwAAAABJRU5ErkJggg==");
                        String first = storage.storeBytes(png, "slide-1.png", "image/png").ref();
                        if (source.filename().contains("partial")) {
                            sink.metadata(3, 3, "RENDERING 0/3", "Импортировано 1 из 3");
                            sink.slide(new ConvertedSlide(1, first, "Слайд 2: ошибка рендера", true), 1, 3);
                            return new SlideConversionResult(
                                    3, 1, true, "Импортировано 1 из 3", "Слайд 2: ошибка рендера");
                        }
                        String second = storage.storeBytes(png, "slide-2.png", "image/png").ref();
                        sink.metadata(2, 2, "RENDERING 0/2", null);
                        sink.slide(new ConvertedSlide(1, first, "V1 golden: " + source.filename(), false), 1, 2);
                        sink.slide(new ConvertedSlide(2, second, "Second rendered slide", false), 2, 2);
                        return new SlideConversionResult(2, 2, false, null, null);
                    } catch (java.io.IOException exception) {
                        throw new IllegalStateException(exception);
                    }
                }
            };
        }
    }
}
