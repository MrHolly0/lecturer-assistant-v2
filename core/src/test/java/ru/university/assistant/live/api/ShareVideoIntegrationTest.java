package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import ru.university.assistant.projection.api.VideoFixture;
import ru.university.assistant.projection.api.FrameFixture;

/** Real receipt/scope checks and committed pause boundaries for ephemeral encoded video. */
class ShareVideoIntegrationTest extends LiveFlowTestBase {
    @Test
    void ownerOnlyPublicationAndActualRegisteredViewerAccessApplyToEveryVideoPart() throws Exception {
        String upload = startShare(); UUID epoch = UUID.randomUUID(), viewer = UUID.randomUUID();
        String jwt = maxLogin(832001), receipt = join(jwt, "{}").path("participantToken").asText();
        String path = viewer(viewer);
        json(get(path + "/video"), 401);
        json(get(path + "/video").header("X-Participant-Token", receipt), 404);
        json(get(path).header("X-Participant-Token", receipt), 200);
        json(get(path + "/video").header("X-Participant-Token", receipt), 204);
        json(put(upload + "/" + epoch + "/init?codec=" + VideoFixture.CODEC)
                .header("Authorization", "Bearer " + adminToken).contentType("video/mp4")
                .content(VideoFixture.init()), 403);
        json(put(upload + "/" + epoch + "/init?codec=" + VideoFixture.CODEC)
                .header("Authorization", "Bearer " + lecturerToken).contentType("image/jpeg")
                .content(VideoFixture.init()), 415);
        init(upload, epoch, 204);
        json(get(path + "/video").header("X-Participant-Token", receipt), 204);
        segment(upload, epoch, 1, 409); segment(upload, epoch, 0, 204);
        JsonNode metadata = json(get(path + "/video").header("X-Participant-Token", receipt), 200);
        assertEquals(epoch.toString(), metadata.path("epoch").asText());
        assertEquals(0, metadata.path("firstSequence").asLong());
        binary(path + "/video/" + epoch + "/init", receipt, VideoFixture.init());
        binary(path + "/video/" + epoch + "/segments/0", receipt, VideoFixture.segment());
        String otherReceipt = join(maxLogin(832002), "{}").path("participantToken").asText();
        json(get(path + "/video").header("X-Participant-Token", otherReceipt), 403);
        json(get(path + "/video/" + epoch + "/segments/0")
                .header("X-Participant-Token", otherReceipt).accept("video/mp4"), 403);
        json(post("/api/v1/courses/{course}/sessions/{session}/participants/{person}/kick",
                courseId, sessionId, personIdOf(jwt)).header("Authorization", "Bearer " + lecturerToken), 200);
        json(get(path + "/video").header("X-Participant-Token", receipt), 403);
        json(get(path + "/video/" + epoch + "/init")
                .header("X-Participant-Token", receipt).accept("video/mp4"), 403);
    }

    @Test
    void pauseThenResumeWithoutPollingRetiresEpochAndCannotLeakBufferedVideoOrJpeg() throws Exception {
        String upload = startShare(); UUID epoch = UUID.randomUUID(), viewer = UUID.randomUUID();
        String receipt = join(maxLogin(832003), "{}").path("participantToken").asText();
        String path = viewer(viewer);
        json(get(path).header("X-Participant-Token", receipt), 200);
        init(upload, epoch, 204); segment(upload, epoch, 0, 204);
        json(put(upload.substring(0, upload.length() - 6) + "/frame")
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.IMAGE_JPEG)
                .content(FrameFixture.jpeg(16, 9)), 204);
        for (String transition : new String[] {"pause", "resume"}) {
            json(post("/api/v1/courses/{course}/sessions/{session}/" + transition, courseId, sessionId)
                    .header("Authorization", "Bearer " + lecturerToken), 200);
        }
        json(get(path + "/video").header("X-Participant-Token", receipt), 204);
        json(get(path + "/frame").header("X-Participant-Token", receipt), 204);
        json(get(path + "/video/" + epoch + "/segments/0")
                .header("X-Participant-Token", receipt).accept("video/mp4"), 410);
        init(upload, epoch, 409);
        UUID fresh = UUID.randomUUID(); init(upload, fresh, 204); segment(upload, fresh, 0, 204);
        json(get(path + "/video").header("X-Participant-Token", receipt), 200);
    }

    @Test
    void malformedAndOversizedVideoDoesNotReplaceAcceptedState() throws Exception {
        String upload = startShare(); UUID epoch = UUID.randomUUID();
        init(upload, epoch, 204); segment(upload, epoch, 0, 204);
        json(put(upload + "/" + epoch + "/segments/1").header("Authorization", "Bearer " + lecturerToken)
                .contentType("video/mp4").content(new byte[2 * 1024 * 1024 + 1]), 413);
        json(put(upload + "/" + epoch + "/segments/1").header("Authorization", "Bearer " + lecturerToken)
                .contentType("video/mp4").content(new byte[] {0, 0, 0, 0}), 400);
        segment(upload, epoch, 1, 204);
    }

    private String startShare() throws Exception {
        String path = "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/screen-share";
        JsonNode share = json(post(path).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sourceName\":\"Демонстрация\"}"), 200);
        return path + "/" + share.path("id").asText() + "/video";
    }
    private String viewer(UUID viewer) {
        return "/api/v1/student/sessions/" + joinCode + "/screen-share/viewers/" + viewer;
    }
    private void init(String upload, UUID epoch, int expected) throws Exception {
        json(put(upload + "/" + epoch + "/init?codec=" + VideoFixture.CODEC)
                .header("Authorization", "Bearer " + lecturerToken).contentType("video/mp4")
                .content(VideoFixture.init()), expected);
    }
    private void segment(String upload, UUID epoch, long sequence, int expected) throws Exception {
        json(put(upload + "/" + epoch + "/segments/" + sequence)
                .header("Authorization", "Bearer " + lecturerToken).contentType("video/mp4")
                .content(VideoFixture.segment()), expected);
    }
    private void binary(String path, String receipt, byte[] expected) throws Exception {
        mockMvc.perform(get(path).header("X-Participant-Token", receipt).accept("video/mp4"))
                .andExpect(status().isOk()).andExpect(content().contentType("video/mp4"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(content().bytes(expected));
    }
}
