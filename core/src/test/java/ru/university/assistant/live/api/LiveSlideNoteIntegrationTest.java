package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class LiveSlideNoteIntegrationTest extends LiveFlowTestBase {

    @Test
    void lecturerCanUpdateCurrentLiveSlideNoteWithoutChangingDeckOrImage() throws Exception {
        JsonNode before = deck();
        String slideId = before.at("/slides/0/id").asText();
        String imageUrl = before.at("/slides/0/imageUrl").asText();
        int version = before.get("version").asInt();
        int slideCount = before.get("slides").size();

        JsonNode note = json(put("/api/v1/courses/{course}/decks/{deck}/slides/1/notes", courseId, deckId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"  Объяснить пример подробнее  \"}"), 200);
        assertEquals("Объяснить пример подробнее", note.get("content").asText());

        JsonNode after = deck();
        assertEquals(version, after.get("version").asInt());
        assertEquals(slideCount, after.get("slides").size());
        assertEquals(slideId, after.at("/slides/0/id").asText());
        assertEquals(imageUrl, after.at("/slides/0/imageUrl").asText());
        assertEquals("Объяснить пример подробнее", after.at("/slides/0/note/content").asText());
    }

    private JsonNode deck() throws Exception {
        return json(get("/api/v1/courses/{course}/decks/{deck}", courseId, deckId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }
}
