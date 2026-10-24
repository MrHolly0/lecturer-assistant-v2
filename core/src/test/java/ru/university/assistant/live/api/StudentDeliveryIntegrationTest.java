package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

class StudentDeliveryIntegrationTest extends LiveFlowTestBase {
    @Test
    void staticSlideReceiptsAreCoalescedWithoutSnapshotFanoutAndReconnectStaysAllowed() throws Exception {
        JsonNode guest = join(null, "{\"displayName\":\"Passive student\"}");
        String token = guest.path("participantToken").asText();
        long revision = revision();
        receipt(token, false, 204);
        Instant first = lastSeen();
        receipt(token, false, 204); // A second window shares the same bounded write.
        assertEquals(first, lastSeen());
        assertEquals(revision, revision());
        jdbc.sql("update live.student_delivery_receipts set last_seen_at = now() - interval '5 minutes'").update();
        JsonNode resumed = join(null, "{\"participantToken\":\"" + token + "\"}");
        assertEquals(guest.path("participantId"), resumed.path("participantId"));
        receipt(token, false, 204);
        assertTrue(lastSeen().isAfter(first));
        assertEquals(revision, revision());
        assertFalse(json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("X-Participant-Token", token), 200).path("kicked").asBoolean());
    }

    @Test
    void deliveredCompletionUsesAuthoritativeEndAndInvalidatesAlreadyPreparedReportOnlyOnce() throws Exception {
        String token = join(null, "{\"displayName\":\"Stayed\"}").path("participantToken").asText();
        receipt(token, false, 204);
        end();
        JsonNode before = summary();
        assertTrue(before.at("/participants/0/completedAt").isNull());
        receipt(token, true, 204);
        JsonNode after = summary();
        assertEquals(after.path("endedAt"), after.at("/participants/0/completedAt"));
        assertTrue(after.at("/participants/0/leftAt").isNull(), "Receipt must not revoke participation");
        long revision = revision();
        receipt(token, true, 204);
        receipt(token, false, 204);
        assertEquals(revision, revision());
        assertEquals(after, summary());
    }

    @Test
    void disconnectedAndLegacyStudentsAreNotInventedAsStayingUntilEnd() throws Exception {
        String token = join(null, "{\"displayName\":\"Disconnected\"}").path("participantToken").asText();
        receipt(token, false, 204);
        jdbc.sql("update live.student_delivery_receipts set last_seen_at = now() - interval '5 minutes'").update();
        Instant departed = lastSeen();
        String legacy = join(null, "{\"displayName\":\"Legacy\"}").path("participantToken").asText();
        end();
        receipt(token, true, 204);
        receipt(legacy, true, 204);
        JsonNode participants = summary().path("participants");
        for (JsonNode participant : participants) {
            assertTrue(participant.path("completedAt").isNull());
            assertTrue(participant.path("leftAt").isNull());
            if (participant.path("displayName").asText().equals("Legacy")) {
                assertTrue(participant.path("lastSeenAt").isNull());
            } else {
                assertEquals(departed, Instant.parse(participant.path("lastSeenAt").asText()));
            }
        }
    }

    @Test
    void oldCompletionCannotBeClaimedLaterEvenWithAnEarlierReceipt() throws Exception {
        String token = join(null, "{\"displayName\":\"Old session\"}").path("participantToken").asText();
        receipt(token, false, 204);
        end();
        jdbc.sql("update live.sessions set ended_at = now() - interval '3 minutes' where id = :id")
                .param("id", sessionId).update();
        receipt(token, true, 204);
        assertTrue(summary().at("/participants/0/completedAt").isNull());
    }

    @Test
    void receiptsNeverJoinOrUnkickAndRequireMatchingSessionAndIdentity() throws Exception {
        receipt(null, false, 401);
        receipt("invalid-token", false, 401);
        String jwt = maxLogin(7878);
        json(request(null, false).header("Authorization", "Bearer " + jwt), 403);
        assertEquals(0L, count("live.student_delivery_receipts"));
        JsonNode guest = join(null, "{\"displayName\":\"Guest\"}");
        String token = guest.path("participantToken").asText();
        json(request(token, false).header("Authorization", "Bearer " + jwt), 403);
        json(request(token, false).content("{\"sessionId\":\"" + UUID.randomUUID()
                + "\",\"completed\":false}"), 409);
        UUID person = jdbc.sql("select person_id from live.web_participant_tokens where id = :id")
                .param("id", UUID.fromString(guest.path("participantId").asText())).query(UUID.class).single();
        json(post("/api/v1/courses/{c}/sessions/{s}/participants/{p}/kick", courseId, sessionId, person)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        receipt(token, false, 403);
        receipt(token, true, 403);
        assertEquals(0L, count("live.student_delivery_receipts"));
    }

    @Test
    void claimingAGuestPreservesItsLastDeliveryWithoutCreatingAnotherAttendanceRecord() throws Exception {
        JsonNode guest = join(null, "{\"displayName\":\"Guest name\"}");
        String token = guest.path("participantToken").asText();
        receipt(token, false, 204);
        Instant seen = lastSeen();
        JsonNode claimed = join(maxLogin(8989), "{\"participantToken\":\"" + token + "\"}");
        assertEquals(1L, count("live.student_delivery_receipts"));
        assertEquals(seen, lastSeen());
        receipt(claimed.path("participantToken").asText(), false, 204);
    }

    @Test
    void authenticatedWindowsSurviveTokenRotationAndRejectAnAccountSwitch() throws Exception {
        String jwt = maxLogin(9009);
        JsonNode first = join(jwt, "{}");
        UUID person = jdbc.sql("select person_id from live.web_participant_tokens where id = :id")
                .param("id", UUID.fromString(first.path("participantId").asText())).query(UUID.class).single();
        join(jwt, "{}"); // A second device rotates the SSE token, not the person's attendance.
        String body = "{\"sessionId\":\"" + sessionId + "\",\"personId\":\"" + person
                + "\",\"completed\":false}";
        json(request(null, false).header("Authorization", "Bearer " + jwt).content(body), 204);
        assertEquals(1L, count("live.student_delivery_receipts"));
        String another = maxLogin(9010);
        join(another, "{}");
        json(request(null, false).header("Authorization", "Bearer " + another).content(body), 403);
        assertEquals(1L, count("live.student_delivery_receipts"));
    }

    private MockHttpServletRequestBuilder request(String token, boolean completed) {
        var request = post("/api/v1/student/sessions/{code}/delivery-receipt", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"" + sessionId + "\",\"completed\":" + completed + "}");
        if (token != null) request.header("X-Participant-Token", token);
        return request;
    }

    private void receipt(String token, boolean completed, int expected) throws Exception {
        json(request(token, completed), expected);
    }

    private Instant lastSeen() {
        return jdbc.sql("select last_seen_at from live.student_delivery_receipts")
                .query(Instant.class).single();
    }

    private long revision() {
        return jdbc.sql("select coalesce(sum(revision), 0) from live.student_snapshot_revisions where session_id = :id")
                .param("id", sessionId).query(Long.class).single();
    }

    private void end() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private JsonNode summary() throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }
}
