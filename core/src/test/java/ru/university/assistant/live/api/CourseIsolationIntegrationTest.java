package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/**
 * D-10: опросы, активности и банк вопросов доступны только через собственный курс. Чужой
 * преподаватель, зная только свой courseId и чужой id вложенной сущности, не должен видеть
 * или менять чужое содержимое. Пример из DEFECTS.md — вторым преподавателем со своим курсом.
 */
class CourseIsolationIntegrationTest extends LiveFlowTestBase {

    @Test
    void foreignLecturerCannotReadOrChangeAnotherCoursesQuestion() throws Exception {
        String questionId = createQuestion(courseId, lecturerToken, "Сколько будет 2+2?").get("id").asText();
        UUID otherCourseId = anotherLecturersCourse();

        json(get("/api/v1/courses/{c}/questions/{q}", otherCourseId, questionId)
                .header("Authorization", "Bearer " + otherLecturerToken), 404);
        json(put("/api/v1/courses/{c}/questions/{q}", otherCourseId, questionId)
                .header("Authorization", "Bearer " + otherLecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(questionBody("Подделанный текст")), 404);
        json(delete("/api/v1/courses/{c}/questions/{q}", otherCourseId, questionId)
                .header("Authorization", "Bearer " + otherLecturerToken), 404);

        // ни чтение, ни попытка правки/архивации не должны были ничего изменить
        JsonNode intact = json(get("/api/v1/courses/{c}/questions/{q}", courseId, questionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("Сколько будет 2+2?", intact.get("text").asText());
        assertEquals(false, intact.get("archived").asBoolean());

        // а собственный преподаватель курса по-прежнему может читать свой вопрос
        json(get("/api/v1/courses/{c}/questions/{q}", courseId, questionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    @Test
    void foreignLecturerCannotReadAnActivityDefinitionOrStartARunAgainstItsOwnSession() throws Exception {
        String questionId = createQuestion(courseId, lecturerToken, "2+2?").get("id").asText();
        String activityBody = "{\"title\":\"Проверка\",\"questionIds\":[\"" + questionId + "\"],\"strategy\":\"ALL\"}";
        String definitionId = json(post("/api/v1/courses/{c}/activities", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(activityBody),
                        201)
                .get("id")
                .asText();
        UUID otherCourseId = anotherLecturersCourse();

        json(get("/api/v1/courses/{c}/activities/{d}", otherCourseId, definitionId)
                .header("Authorization", "Bearer " + otherLecturerToken), 404);

        // чужая сессия (из courseId владельца) не принадлежит courseId атакующего — тоже 404,
        // даже если запустить прогон через СВОЙ definitionId невозможно проверить без пары "чужой
        // definition + свой courseId+session", это и есть сценарий ниже
        json(post("/api/v1/courses/{c}/sessions/{s}/activities/{d}/runs", otherCourseId, sessionId, definitionId)
                .header("Authorization", "Bearer " + otherLecturerToken), 404);

        assertEquals(0L, count("interaction.activity_runs"));
    }

    @Test
    void foreignLecturerCannotActOnAnotherCoursesPollThroughItsOwnCourseId() throws Exception {
        UUID pollId = UUID.fromString(json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"questionText\":\"Что верно?\",\"options\":[\"A\",\"B\"]}"), 201)
                .get("poll")
                .get("id")
                .asText());
        UUID otherCourseId = anotherLecturersCourse();

        // тот же трюк, что и в DEFECTS.md: свой courseId в пути, чужие sessionId/pollId в хвосте
        json(get("/api/v1/courses/{c}/sessions/{s}/polls/active", otherCourseId, sessionId)
                .header("Authorization", "Bearer " + otherLecturerToken), 404);
        json(get("/api/v1/courses/{c}/sessions/{s}/polls/{p}", otherCourseId, sessionId, pollId)
                .header("Authorization", "Bearer " + otherLecturerToken), 404);
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", otherCourseId, sessionId, pollId)
                        .header("Authorization", "Bearer " + otherLecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"correctOptionIdx\":0}"),
                404);

        // опрос не закрылся чужой рукой — свой преподаватель всё ещё видит его открытым
        JsonNode ownView = json(get("/api/v1/courses/{c}/sessions/{s}/polls/{p}", courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("OPEN", ownView.get("poll").get("status").asText());
    }

    private String otherLecturerToken;

    private UUID anotherLecturersCourse() throws Exception {
        String invite = json(post("/api/v1/admin/invitations")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"), 201)
                .get("code")
                .asText();
        otherLecturerToken = json(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"invitationCode\":\"" + invite + "\",\"displayName\":\"Other Lecturer\","
                                + "\"email\":\"other-lecturer@example.test\",\"password\":\"password-123\"}"), 200)
                .get("accessToken")
                .asText();
        return UUID.fromString(json(post("/api/v1/courses")
                        .header("Authorization", "Bearer " + otherLecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Чужой курс\"}"), 201)
                .get("id")
                .asText());
    }

    private JsonNode createQuestion(UUID course, String token, String text) throws Exception {
        return json(post("/api/v1/courses/{c}/questions", course)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(questionBody(text)), 201);
    }

    private String questionBody(String text) {
        return "{\"text\":\"" + text + "\",\"questionType\":\"CHOICE\",\"options\":"
                + "[{\"text\":\"4\",\"correct\":true},{\"text\":\"5\",\"correct\":false}]}";
    }
}
