package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import ru.university.assistant.iam.internal.MaxInitDataSigner;
import ru.university.assistant.org.api.GroupFormatPolicy;
import ru.university.assistant.org.api.GroupFormatPolicy.Choice;
import ru.university.assistant.org.api.GroupFormatPolicy.Field;

@SpringBootTest(properties = {"app.experimental.messenger-login=true",
        "app.telegram.bot-token=messenger-test-token-not-a-secret",
        "app.vk.app-id=900", "app.vk.app-secret=vk-test-secret-not-a-secret"})
class MessengerStudentExperienceIntegrationTest extends LiveFlowTestBase {
    private String signed(long id) {
        return MaxInitDataSigner.sign("messenger-test-token-not-a-secret", Map.of(
                "auth_date", Long.toString(Instant.now().getEpochSecond()),
                "user", MaxInitDataSigner.userJson(id, "Иван", "Петров")));
    }

    private JsonNode messenger(long id, String code, int expected) throws Exception {
        return json(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "telegram", "initData", signed(id),
                        "linkCode", code))), expected);
    }

    @Test
    void messengerUsesOneProfileAndSeparateRefreshCookieAndExplicitLinkCode() throws Exception {
        var result = mockMvc.perform(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "telegram", "initData", signed(987)))))
                .andExpect(status().isOk()).andReturn();
        var auth = objectMapper.readTree(result.getResponse().getContentAsString());
        Cookie cookie = result.getResponse().getCookie("la_telegram_refresh");
        assertTrue(cookie != null && cookie.getSecure() && cookie.isHttpOnly());
        assertEquals(auth.path("user").path("id"), messenger(987, "", 200).path("user").path("id"));
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie).header("X-Auth-Channel", "telegram"))
                .andExpect(status().isOk());
        String code = json(post("/api/v1/identity/link-codes").header("Authorization", "Bearer " + lecturerToken), 201)
                .path("code").asText();
        var linked = messenger(1234, code, 200);
        assertEquals("LECTURER", linked.path("user").path("role").asText());
        assertEquals(linked.path("user").path("id"), messenger(1234, "", 200).path("user").path("id"));
        messenger(5678, code, 400);
    }

    @Test
    void guestCanLeaveAndReturnWithoutDuplicatesWhileOldReceiptsStayRevoked() throws Exception {
        JsonNode entered = join(null, "{\"displayName\":\"Student\"}");
        String old = entered.path("participantToken").asText();
        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/student/sessions/{code}/leave", joinCode)
                    .header("X-Participant-Token", old)).andExpect(status().isNoContent());
        }
        String receipt = objectMapper.writeValueAsString(Map.of("sessionId", sessionId, "completed", false));
        mockMvc.perform(post("/api/v1/student/sessions/{code}/delivery-receipt", joinCode)
                .header("X-Participant-Token", old).contentType(MediaType.APPLICATION_JSON).content(receipt))
                .andExpect(status().isForbidden());
        JsonNode returned = join(null, "{\"participantToken\":\"" + old + "\"}");
        assertNotEquals(old, returned.path("participantToken").asText());
        assertEquals(1L, jdbc.sql("select count(*) from live.session_participants").query(Long.class).single());
        assertEquals(2L, jdbc.sql("select count(*) from live.student_visit_events").query(Long.class).single());
        mockMvc.perform(post("/api/v1/student/sessions/{code}/delivery-receipt", joinCode)
                .header("X-Participant-Token", old).contentType(MediaType.APPLICATION_JSON).content(receipt))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void cabinetShowsBothGroupLecturesInsteadOfLockingStudentIntoOldOne() throws Exception {
        String student = messenger(987, "", 200).path("accessToken").asText();
        join(student, "{}");
        JsonNode another = startAnotherSession();
        JsonNode cabinet = json(get("/api/v1/me/student-cabinet")
                .header("Authorization", "Bearer " + student), 200);
        assertEquals(2, cabinet.path("ongoing").size());
        assertEquals(1L, cabinet.path("historyTotal").asLong());
        mockMvc.perform(post("/api/v1/student/sessions/{code}/leave", joinCode)
                .header("Authorization", "Bearer " + student)).andExpect(status().isNoContent());
        json(post("/api/v1/student/sessions/{code}/join", another.path("joinCode").asText())
                .header("Authorization", "Bearer " + student)
                .contentType(MediaType.APPLICATION_JSON).content("{}"), 200);
        cabinet = json(get("/api/v1/me/student-cabinet").header("Authorization", "Bearer " + student), 200);
        assertEquals(2, cabinet.path("ongoing").size());
        assertEquals(2L, cabinet.path("historyTotal").asLong());
        mockMvc.perform(get("/api/v1/me/student-cabinet")).andExpect(status().isUnauthorized());
    }

    @Test
    void institutionFormatNormalizesNamesAndExistingIdsArePreservedOnReview() throws Exception {
        long revision = json(get("/api/v1/group-format").header("Authorization", "Bearer " + adminToken), 200)
                .path("revision").asLong();
        var policy = new GroupFormatPolicy(revision, true, List.of(
                new Field("level", "Уровень", "CHOICE", "", 0, 0, "б",
                        List.of(new Choice("б", "Бакалавриат", List.of()), new Choice("м", "Магистратура", List.of()))),
                new Field("program", "Направление", "CHOICE", "", 0, 0, null,
                        List.of(new Choice("ИСТ", "Информационные системы и технологии", List.of()))),
                new Field("year", "Год", "YEAR", "-", 2, 2000, null, List.of()),
                new Field("number", "Номер", "NUMBER", "", 1, 0, null, List.of())));
        String body = objectMapper.writeValueAsString(policy);
        mockMvc.perform(put("/api/v1/admin/group-format").header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
        json(put("/api/v1/admin/group-format").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(body), 200);
        var first = json(post("/api/v1/courses/{id}/groups", courseId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"БИСТ234\"}"), 201);
        var same = json(post("/api/v1/courses/{id}/groups", courseId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"ИСТ-234\"}"), 201);
        assertEquals("бИСТ-234", first.path("name").asText());
        assertEquals(first.path("id"), same.path("id"));
        assertTrue(jdbc.sql("select exists(select 1 from org.study_groups where id=:id)")
                .param("id", groupId).query(Boolean.class).single());
        mockMvc.perform(post("/api/v1/courses/{id}/groups", courseId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"что-то другое\"}")).andExpect(status().isUnprocessableEntity());
    }
    @Test
    void leftProfileCannotBeRevivedByLateCommandsAndOtherStudentCannotLeaveIt() throws Exception {
        var auth = messenger(987, "", 200);
        String token = auth.path("accessToken").asText();
        var entered = join(token, "{}");
        String participant = entered.path("participantToken").asText();
        String other = messenger(988, "", 200).path("accessToken").asText();
        mockMvc.perform(post("/api/v1/student/sessions/{code}/leave", joinCode)
                .header("Authorization", "Bearer " + other).header("X-Participant-Token", participant))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/student/sessions/{code}/leave", joinCode)
                .header("Authorization", "Bearer " + token)).andExpect(status().isNoContent());
        String receipt = objectMapper.writeValueAsString(Map.of("sessionId", sessionId, "completed", false));
        mockMvc.perform(post("/api/v1/student/sessions/{code}/delivery-receipt", joinCode)
                .header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON).content(receipt))
                .andExpect(status().isForbidden());
        var returned = join(token, objectMapper.writeValueAsString(Map.of("participantToken", participant)));
        assertNotEquals(participant, returned.path("participantToken").asText());
        assertEquals(1L, jdbc.sql("select count(*) from live.session_participants").query(Long.class).single());
    }

    @Test
    void cohortDiscoveryCrossesCourseNamesButHonorsDegreeAndCourseBan() throws Exception {
        var auth = messenger(987, "", 200);
        String token = auth.path("accessToken").asText();
        UUID person = UUID.fromString(auth.path("user").path("id").asText());
        join(token, "{}");
        var second = startAnotherSession();
        UUID secondSession = UUID.fromString(second.path("id").asText());
        UUID otherCourse = UUID.randomUUID();
        UUID otherGroup = UUID.randomUUID();
        jdbc.sql("insert into org.courses(id,owner_person_id,title) "
                + "select :id,owner_person_id,'Other course' from org.courses where id=:old")
                .param("id", otherCourse).param("old", courseId).update();
        UUID otherLecture = jdbc.sql("select lecture_id from live.sessions where id=:id")
                .param("id", secondSession).query(UUID.class).single();
        jdbc.sql("update live.lectures set course_id=:course where id=:id")
                .param("course", otherCourse).param("id", otherLecture).update();
        jdbc.sql("insert into org.study_groups(id,course_id,name,cohort_key) values(:id,:course,'бИСТ234','cohort')")
                .param("id", otherGroup).param("course", otherCourse).update();
        jdbc.sql("update org.study_groups set cohort_key='cohort' where id=:id").param("id", groupId).update();
        jdbc.sql("update live.session_groups set group_id=:group where session_id=:id")
                .param("group", otherGroup).param("id", secondSession).update();
        assertEquals(2, json(get("/api/v1/me/student-cabinet").header("Authorization", "Bearer " + token), 200)
                .path("ongoing").size());
        jdbc.sql("update org.study_groups set cohort_key='masters' where id=:id").param("id", otherGroup).update();
        assertEquals(1, json(get("/api/v1/me/student-cabinet").header("Authorization", "Bearer " + token), 200)
                .path("ongoing").size());
        jdbc.sql("update org.study_groups set cohort_key='cohort' where id=:id").param("id", otherGroup).update();
        jdbc.sql("insert into iam.course_bans(course_id,person_id,banned_by) "
                + "select :course,:person,owner_person_id from org.courses where id=:course")
                .param("course", otherCourse).param("person", person).update();
        assertEquals(1, json(get("/api/v1/me/student-cabinet").header("Authorization", "Bearer " + token), 200)
                .path("ongoing").size());
    }

    @Test
    void reconciliationAdvancesPastUnrecognizedRowsAndPolicySaveUsesRevision() throws Exception {
        long revision = jdbc.sql("select revision from org.group_format_policy").query(Long.class).single();
        var policy = new GroupFormatPolicy(revision, true, List.of(
                new Field("number", "Номер", "NUMBER", "", 3, 0, null, List.of())));
        String body = objectMapper.writeValueAsString(policy);
        json(put("/api/v1/admin/group-format").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(body), 200);
        mockMvc.perform(put("/api/v1/admin/group-format").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isConflict());
        jdbc.sql("insert into org.study_groups(id,course_id,name) values(:id,:course,'234')")
                .param("id", UUID.randomUUID()).param("course", courseId).update();
        String request = objectMapper.writeValueAsString(Map.of("revision", revision + 1));
        var result = json(post("/api/v1/admin/group-format/reconcile").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(request), 200);
        assertEquals(1, result.path("matched").asInt());
        assertTrue(result.path("unrecognized").asInt() > 0);
        result = json(post("/api/v1/admin/group-format/reconcile").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(request), 200);
        assertEquals(0, result.path("matched").asInt());
        assertEquals(0, result.path("unrecognized").asInt());
    }

    @Test
    void vkIdentityIsSeparateFromTelegramAndBothCanLinkToOneExistingProfile() throws Exception {
        String data = "vk_app_id=900&vk_ts=" + Instant.now().getEpochSecond() + "&vk_user_id=987";
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec("vk-test-secret-not-a-secret".getBytes(
                java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
        String signed = data + "&sign=" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                mac.doFinal(data.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var telegram = messenger(987, "", 200);
        var result = mockMvc.perform(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "vk", "initData", signed))))
                .andExpect(status().isOk()).andReturn();
        var vk = objectMapper.readTree(result.getResponse().getContentAsString());
        assertNotEquals(telegram.path("user").path("id"), vk.path("user").path("id"));
        var cookie = result.getResponse().getCookie("la_vk_refresh");
        assertTrue(cookie != null && cookie.getSecure() && cookie.isHttpOnly());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie).header("X-Auth-Channel", "telegram"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie).header("X-Auth-Channel", "vk"))
                .andExpect(status().isOk());
        String code = json(post("/api/v1/identity/link-codes")
                .header("Authorization", "Bearer " + telegram.path("accessToken").asText()), 201).path("code").asText();
        // A VK identity already attached to another profile must not silently switch owners.
        mockMvc.perform(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("channel", "vk", "initData", signed, "linkCode", code))))
                .andExpect(status().isConflict());
        assertEquals(1L, jdbc.sql("select count(*) from iam.identity_link_codes where code=:code and used_at is null")
                .param("code", code).query(Long.class).single());
        String otherData = data.replace("vk_user_id=987", "vk_user_id=988");
        String fresh = otherData + "&sign=" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                mac.doFinal(otherData.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var linked = json(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "vk", "initData", fresh, "linkCode", code))),
                200);
        assertEquals(telegram.path("user").path("id"), linked.path("user").path("id"));
    }

}
