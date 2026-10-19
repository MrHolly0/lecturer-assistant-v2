package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import ru.university.assistant.projection.api.FrameFixture;

class ShareFrameChatIntegrationTest extends LiveFlowTestBase {
    private static final String INTERNAL_KEY = "phase-4-local-channel-key";

    @Test
    void ownBoundMaxChatReceivesOneOriginalDocumentAndOnlyAdapterCanRetrieveIt() throws Exception {
        String jwt = maxLogin(842001);
        String receipt = join(jwt, "{}").get("participantToken").asText();
        byte[] jpeg = FrameFixture.jpeg(1920, 1080);
        String shareId = startShareAndFrame(jpeg);
        for (int i = 0; i < 2; i++) {
            json(post(chatPath()).header("X-Participant-Token", receipt)
                    .header("Authorization", "Bearer " + jwt), 202);
        }
        assertEquals(1L, count("channel.outbox where thread_key = 'requested-share-frame'"));
        Map<String, Object> message = jdbc.sql("""
                        select o.channel_identity_id, o.content->>'ref' as ref,
                            o.content->>'caption' as caption, o.content->>'type' as type
                        from channel.outbox o where thread_key = 'requested-share-frame'
                        """).query().singleRow();
        assertEquals("DOCUMENT", message.get("type"));
        assertTrue(message.get("caption").toString().contains("Получен сервером"));
        assertTrue(message.get("caption").toString().contains("UTC"));
        UUID identity = jdbc.sql("select id from iam.channel_identities where external_id = '842001'")
                .query(UUID.class).single();
        assertEquals(identity, message.get("channel_identity_id"));
        String ref = message.get("ref").toString();
        assertTrue(ref.matches("/internal/v1/channels/max/media/[A-Za-z0-9_-]{43}"));
        json(get(ref), 401);
        json(get(ref).header("Authorization", "Bearer " + jwt), 401);
        json(get(ref).header("X-Internal-Api-Key", "wrong"), 401);
        mockMvc.perform(get(ref).header("X-Internal-Api-Key", INTERNAL_KEY))
                .andExpect(status().isOk()).andExpect(content().bytes(jpeg))
                .andExpect(header().string("Cache-Control", "no-store"));
        json(delete(staffPath() + "/" + shareId).header("Authorization", "Bearer " + lecturerToken), 204);
        // An explicitly requested document can finish delivery after the public show stops.
        mockMvc.perform(get(ref).header("X-Internal-Api-Key", INTERNAL_KEY))
                .andExpect(status().isOk()).andExpect(content().bytes(jpeg));
        jdbc.sql("update iam.persons set status = 'DISABLED' where id = :person")
                .param("person", UUID.fromString(personIdOf(jwt))).update();
        json(get(ref).header("X-Internal-Api-Key", INTERNAL_KEY), 410);
    }

    @Test
    void rejectsAnonymousUnjoinedGuestAndMismatchedAccountWithoutRegisteringAnyone() throws Exception {
        startShareAndFrame(FrameFixture.jpeg(16, 9));
        long before = count("live.session_participants");
        json(post(chatPath()), 401);
        String unjoined = maxLogin(842002);
        json(post(chatPath()).header("Authorization", "Bearer " + unjoined), 403);
        assertEquals(before, count("live.session_participants"));
        String receipt = join(unjoined, "{}").get("participantToken").asText();
        String other = maxLogin(842003);
        join(other, "{}");
        json(post(chatPath()).header("Authorization", "Bearer " + other)
                .header("X-Participant-Token", receipt), 403);
        String guest = join(null, "{\"displayName\":\"Guest\"}").get("participantToken").asText();
        mockMvc.perform(post(chatPath()).header("X-Participant-Token", guest))
                .andExpect(status().isConflict());
        assertEquals(0L, count("channel.outbox where thread_key = 'requested-share-frame'"));
    }

    @Test
    void pauseStopAndKickDenyNewChatSnapshots() throws Exception {
        String jwt = maxLogin(842004);
        String receipt = join(jwt, "{}").get("participantToken").asText();
        String shareId = startShareAndFrame(FrameFixture.jpeg(16, 9));
        json(post("/api/v1/courses/{course}/sessions/{session}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(post(chatPath()).header("X-Participant-Token", receipt), 409);
        json(post("/api/v1/courses/{course}/sessions/{session}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(post(chatPath()).header("X-Participant-Token", receipt), 409);
        json(delete(staffPath() + "/" + shareId).header("Authorization", "Bearer " + lecturerToken), 204);
        json(post(chatPath()).header("X-Participant-Token", receipt), 409);
        json(post("/api/v1/courses/{course}/sessions/{session}/participants/{person}/kick",
                        courseId, sessionId, personIdOf(jwt))
                .header("Authorization", "Bearer " + lecturerToken), 200);
        long rows = count("live.session_participants");
        json(post(chatPath()).header("X-Participant-Token", receipt), 403);
        assertEquals(rows, count("live.session_participants"));
        assertEquals(0L, count("channel.outbox where thread_key = 'requested-share-frame'"));
    }

    private String startShareAndFrame(byte[] jpeg) throws Exception {
        JsonNode share = json(post(staffPath()).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sourceName\":\"Teaching window\"}"), 200);
        String id = share.get("id").asText();
        json(put(staffPath() + "/" + id + "/frame").header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 204);
        return id;
    }

    private String staffPath() {
        return "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/screen-share";
    }

    private String chatPath() {
        return "/api/v1/student/sessions/" + joinCode + "/screen-share/frame/chat";
    }
}
