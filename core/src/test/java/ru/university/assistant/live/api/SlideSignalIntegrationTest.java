package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** B-06 / D-04: сигнал понимания привязан к слайду, смена слайда сбрасывает актуальный агрегат. */
class SlideSignalIntegrationTest extends LiveFlowTestBase {

    @Test
    void signalIsScopedToTheSlideItWasSentOnAndResetsWhenSlideChanges() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();

        signal(token, "GREEN"); // на слайде 1 (сессия стартует на нём)
        assertAggregate(engagement().get("signalAggregate"), 1, 0, 0, 1);

        changeSlide(2);
        // смена слайда: актуальный агрегат — по новому слайду, старый сигнал в нём не участвует
        assertAggregate(engagement().get("signalAggregate"), 0, 0, 0, 0);
        assertAggregate(snapshot().get("signalAggregate"), 0, 0, 0, 0);

        signal(token, "RED"); // на слайде 2
        assertAggregate(engagement().get("signalAggregate"), 0, 0, 1, 1);
        assertAggregate(snapshot().get("signalAggregate"), 0, 0, 1, 1);

        // тот же студент, тот же слайд, другое значение — обновление, а не вторая строка
        signal(token, "YELLOW");
        assertAggregate(engagement().get("signalAggregate"), 0, 1, 0, 1);
        assertEquals(2L, count("feedback.comprehension_signals")); // слайд 1 (GREEN) + слайд 2 (YELLOW)

        JsonNode problemSlides = engagement().get("problemSlides");
        assertEquals(2, problemSlides.size());
        // сортировка по числу красных: у слайда 2 сигнал уже сменился на жёлтый, у слайда 1 сигналов нет
        assertEquals(1, problemSlides.get(0).get("slideIdx").asInt());
        assertAggregate(problemSlides.get(0).get("signals"), 1, 0, 0, 1);
        assertEquals(2, problemSlides.get(1).get("slideIdx").asInt());
        assertAggregate(problemSlides.get(1).get("signals"), 0, 1, 0, 1);
    }

    private void signal(String token, String value) throws Exception {
        json(post("/api/v1/student/sessions/{code}/signals", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + token + "\",\"value\":\"" + value + "\"}"), 200);
    }

    private void changeSlide(int slideIdx) throws Exception {
        json(put("/api/v1/courses/{c}/sessions/{s}/slide", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slideIdx\":" + slideIdx + "}"), 200);
    }

    private JsonNode engagement() throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/engagement", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private JsonNode snapshot() throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode), 200);
    }

    private void assertAggregate(JsonNode aggregate, int green, int yellow, int red, int total) {
        assertEquals(green, aggregate.get("green").asInt());
        assertEquals(yellow, aggregate.get("yellow").asInt());
        assertEquals(red, aggregate.get("red").asInt());
        assertEquals(total, aggregate.get("total").asInt());
    }
}
