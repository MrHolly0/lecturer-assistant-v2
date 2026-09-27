package ru.university.assistant.live.api;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** B-04 / D-01 / D-14: участник лекции — это человек, повторный вход не плодит участников и членов курса. */
class StudentIdentityIntegrationTest extends LiveFlowTestBase {
    @Test
    void maxLoginClaimsGuestParticipationWithNameGroupAndAnswers() throws Exception {
        JsonNode guest = join(null, "{\"displayName\":\"Анна Смирнова\"}");
        String guestToken = guest.get("participantToken").asText();
        UUID guestId = jdbc.sql("""
                        select person_id from live.session_participants
                        where session_id = :sessionId and display_name = 'Анна Смирнова'
                        """)
                .param("sessionId", sessionId)
                .query(UUID.class).single();
        act("/api/v1/student/sessions/{joinCode}/signals", null,
                "{\"participantToken\":\"" + guestToken + "\",\"value\":\"RED\"}", 200);
        act("/api/v1/student/sessions/{joinCode}/questions", null,
                "{\"participantToken\":\"" + guestToken + "\",\"text\":\"Что означает этот слайд?\"}", 201);

        String jwt = maxLogin(9201);
        UUID personId = UUID.fromString(personIdOf(jwt));
        JsonNode claimed = join(jwt, "{\"participantToken\":\"" + guestToken + "\"}");
        assertEquals("PROFILE", claimed.get("identityLevel").asText());
        assertEquals(1L, count("live.session_participants where session_id = '" + sessionId + "'"));
        assertEquals(0L, count("live.session_participants where person_id = '" + guestId + "'"));
        assertEquals("Анна Смирнова", jdbc.sql("""
                        select display_name from live.session_participants
                        where session_id = :sessionId and person_id = :personId
                        """)
                .param("sessionId", sessionId).param("personId", personId)
                .query(String.class).single());
        assertEquals("Анна Смирнова", json(get("/api/v1/auth/me")
                .header("Authorization", "Bearer " + jwt), 200).get("displayName").asText());
        assertEquals(groupId, jdbc.sql("""
                        select group_id from live.session_participants
                        where session_id = :sessionId and person_id = :personId
                        """)
                .param("sessionId", sessionId).param("personId", personId)
                .query(UUID.class).single());
        assertEquals(1L, count("feedback.comprehension_signals where person_id = '" + personId + "'"));
        assertEquals(1L, count("qa.questions where person_id = '" + personId + "'"));
        assertEquals(joinCode, json(get("/api/v1/me/student-active-session")
                .header("Authorization", "Bearer " + jwt), 200).get("joinCode").asText());

        act("/api/v1/student/sessions/{joinCode}/name", jwt,
                "{\"lastName\":\"Смирнова\",\"firstName\":\"Анна\"}", 200);

        join(jwt, "{}");
        assertEquals(1L, count("live.session_participants where session_id = '" + sessionId + "'"));
        assertEquals("Смирнова Анна", jdbc.sql("""
                        select display_name from live.session_participants
                        where session_id = :sessionId and person_id = :personId
                        """)
                .param("sessionId", sessionId).param("personId", personId)
                .query(String.class).single());
        assertEquals("Смирнова Анна", json(get("/api/v1/auth/me")
                .header("Authorization", "Bearer " + jwt), 200).get("displayName").asText());
    }

    @Test
    void returningMaxStudentResumesJoinedLectureWithoutAnotherCode() throws Exception {
        String jwt = maxLogin(9090);
        json(get("/api/v1/me/student-active-session").header("Authorization", "Bearer " + jwt), 204);

        join(jwt, "{}");
        JsonNode active = json(get("/api/v1/me/student-active-session")
                .header("Authorization", "Bearer " + jwt), 200);
        assertEquals(joinCode, active.get("joinCode").asText());

        json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(get("/api/v1/me/student-active-session").header("Authorization", "Bearer " + jwt), 204);
    }

    @Test
    void studentResumeNeverReturnsAnotherStudentOrKickedParticipation() throws Exception {
        String joinedJwt = maxLogin(9091);
        String otherJwt = maxLogin(9092);
        join(joinedJwt, "{}");
        json(get("/api/v1/me/student-active-session").header("Authorization", "Bearer " + otherJwt), 204);

        json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/participants/{personId}/kick",
                        courseId, sessionId, personIdOf(joinedJwt))
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(get("/api/v1/me/student-active-session").header("Authorization", "Bearer " + joinedJwt), 204);
    }

    @Test
    void projectorCanReceivePublicUpdatesWithoutLecturerLogin() throws Exception {
        mockMvc.perform(get("/api/v1/student/sessions/{joinCode}/events/public", joinCode)
                        .accept(MediaType.TEXT_EVENT_STREAM))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());
    }

    @Test
    void lecturerCanRemoveStudentWhoCanExplicitlyRejoin() throws Exception {
        String jwt = maxLogin(505);
        String personId = personIdOf(jwt);
        JsonNode first = join(jwt, "{}");
        String token = first.get("participantToken").asText();

        json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/participants/{personId}/kick",
                        courseId, sessionId, personId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        mockMvc.perform(get("/api/v1/student/sessions/{joinCode}", joinCode)
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kicked").value(true))
                .andExpect(jsonPath("$.currentSlide").isEmpty());
        act("/api/v1/student/sessions/{joinCode}/signals", jwt, "{\"value\":\"GREEN\"}", 403);
        act("/api/v1/student/sessions/{joinCode}/signals", null,
                "{\"participantToken\":\"" + token + "\",\"value\":\"GREEN\"}", 403);

        JsonNode rejoined = join(jwt, "{}");
        assertEquals(false, rejoined.get("snapshot").get("kicked").asBoolean());
        act("/api/v1/student/sessions/{joinCode}/signals", jwt, "{\"value\":\"GREEN\"}", 200);
        assertEquals(1L, count("live.session_participants where person_id = '" + personId + "'"));
    }

    @Test
    void nameRequestAndSlideDeliveryUseCurrentStudentAndMaxIdentity() throws Exception {
        String jwt = maxLogin(606);
        String personId = personIdOf(jwt);
        JsonNode joined = join(jwt, "{}");
        String token = joined.get("participantToken").asText();

        json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/participants/{personId}/request-name",
                        courseId, sessionId, personId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        mockMvc.perform(get("/api/v1/student/sessions/{joinCode}", joinCode)
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nameRequested").value(true));

        json(post("/api/v1/student/sessions/{joinCode}/name", joinCode)
                .header("Authorization", "Bearer " + jwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"lastName\":\"Петров\",\"firstName\":\"Иван\"}"), 200);
        mockMvc.perform(get("/api/v1/courses/{courseId}/sessions/{sessionId}/participants", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].displayName").value("Петров Иван"))
                .andExpect(jsonPath("$[0].nameSubmittedAt").exists());

        for (int i = 0; i < 2; i++) {
            json(post("/api/v1/student/sessions/{joinCode}/slides/current/send-to-chat", joinCode)
                    .header("X-Participant-Token", token), 202);
        }
        assertEquals(1L, count("channel.outbox where channel_type = 'max' and content->>'type' = 'IMAGE' "
                + "and content->>'ref' like '%" + courseId + "%'"));
        String imageUrl = jdbc.sql("""
                        select content->>'ref' from channel.outbox
                        where channel_type = 'max' and content->>'type' = 'IMAGE'
                            and content->>'ref' like :coursePattern
                        """)
                .param("coursePattern", "%" + courseId + "%")
                .query(String.class)
                .single();
        mockMvc.perform(get(imageUrl)).andExpect(status().isOk());
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
    void anonymousJoinWithBlankOrShortNameGetsGuestName() throws Exception {
        join(null, "{\"displayName\":\"\"}");
        join(null, "{\"displayName\":\"я\"}");
        join(null, null);

        assertEquals(3L, count("iam.persons where status = 'EPHEMERAL' and display_name like 'Гость %'"));
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
}
