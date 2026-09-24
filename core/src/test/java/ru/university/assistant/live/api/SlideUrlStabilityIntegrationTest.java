package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * D-03: подпись ссылки на слайд не должна пересчитываться на каждый запрос снапшота, иначе
 * каждый студент перекачивает картинку слайда заново при каждом тике SSE. Сквозная проверка
 * через реальный HTTP-стек и базу, в дополнение к юнит-тестам SignedSlideUrlServiceTest.
 *
 * Опрашивает снапшот в течение секунды с лишним реального времени: старый код пересчитывал
 * expiresAt от текущей секунды при каждом вызове, поэтому URL менялся ровно на границе секунды.
 */
class SlideUrlStabilityIntegrationTest extends LiveFlowTestBase {

    @Test
    void slideImageUrlStaysTheSameAcrossASecondBoundary() throws Exception {
        Set<String> urls = new HashSet<>();
        long deadline = System.currentTimeMillis() + 1300;
        do {
            JsonNode snapshot = json(get("/api/v1/student/sessions/{code}", joinCode), 200);
            urls.add(snapshot.get("currentSlide").get("imageUrl").asText());
            Thread.sleep(120);
        } while (System.currentTimeMillis() < deadline);

        assertEquals(1, urls.size(), "URL картинки менялся, хотя окно подписи не истекло: " + urls);
    }
}
