package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class CommandReliabilityIntegrationTest extends LiveFlowTestBase {
    @Test
    void staleCommandsConflictWhileIdenticalAnnotationAndTransitionRetriesAreNoOps() throws Exception {
        long initial = json(get("/api/v1/courses/{c}/sessions/{s}", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200).get("version").asLong();
        String drawing = "{\"annotations\":{\"1\":[{\"x\":0.5}]},\"expectedVersion\":" + initial + "}";
        long changed = json(put("/api/v1/courses/{c}/sessions/{s}/annotations", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(drawing), 200).get("version").asLong();
        assertEquals(changed, json(put("/api/v1/courses/{c}/sessions/{s}/annotations", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(drawing), 200).get("version").asLong());
        json(put("/api/v1/courses/{c}/sessions/{s}/annotations", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"annotations\":{},\"expectedVersion\":" + initial + "}"), 409);
        json(put("/api/v1/courses/{c}/sessions/{s}/slide", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"slideIdx\":2,\"expectedVersion\":" + initial + "}"), 409);
        assertEquals(1, count("analytics.events where verb = 'slide.annotations_updated'"));
        for (String transition : new String[] {"pause", "end"}) {
            var first = json(post("/api/v1/courses/{c}/sessions/{s}/" + transition, courseId, sessionId)
                    .header("Authorization", "Bearer " + lecturerToken), 200);
            var retry = json(post("/api/v1/courses/{c}/sessions/{s}/" + transition, courseId, sessionId)
                    .header("Authorization", "Bearer " + lecturerToken), 200);
            assertEquals(first.get("version"), retry.get("version"));
        }
    }

    @Test
    void bankQuestionCreateAndStudentQuestionReplayOnlyOnce() throws Exception {
        String body = "{\"text\":\"Once?\",\"questionType\":\"CHOICE\","
                + "\"options\":[{\"text\":\"A\",\"correct\":true},{\"text\":\"B\",\"correct\":false}]}";
        var request = post("/api/v1/courses/{c}/questions", courseId)
                .header("Authorization", "Bearer " + lecturerToken).header("Idempotency-Key", "bank-once")
                .contentType(MediaType.APPLICATION_JSON).content(body);
        var first = json(request, 201);
        assertEquals(first.get("id"), json(request, 201).get("id"));
        assertEquals(1, count("interaction.question_bank"));
        String participant = join(maxLogin(98995), "{}").get("participantToken").asText();
        var studentRequest = post("/api/v1/student/sessions/{c}/questions", joinCode)
                .header("Idempotency-Key", "student-once").contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participant + "\",\"text\":\"Повтори?\"}");
        var question = json(studentRequest, 201);
        assertEquals(question.get("id"), json(studentRequest, 201).get("id"));
        assertEquals(1, count("qa.questions"));
        var signal = post("/api/v1/student/sessions/{c}/signals", joinCode).contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participant + "\",\"value\":\"GREEN\"}");
        json(signal, 200);
        json(signal, 200);
        assertEquals(1, count("analytics.events where verb = 'feedback.signal_submitted'"));
    }
    @Test
    void quickAndBankPollResponseLossDoesNotStartAnotherPollOrNotification() throws Exception {
        String path = "/api/v1/courses/{c}/sessions/{s}/polls";
        var request = post(path, courseId, sessionId).header("Authorization", "Bearer " + lecturerToken)
                .header("Idempotency-Key", "quick-once").contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Once?\",\"options\":[\"A\",\"B\"]}");
        var first = json(request, 201);
        assertEquals(first.at("/poll/id"), json(request, 201).at("/poll/id"));
        assertEquals(1, count("interaction.quick_polls"));
        assertEquals(1, count("analytics.events where verb = 'interaction.poll_started'"));
        json(post(path + "/{p}/close", courseId, sessionId, first.at("/poll/id").asText())
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 200);
        var bank = json(post("/api/v1/courses/{c}/questions", courseId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"Bank?\",\"questionType\":\"TRUE_FALSE\","
                        + "\"options\":[{\"text\":\"Да\",\"correct\":true},"
                        + "{\"text\":\"Нет\",\"correct\":false}]}"), 201);
        var fromBank = post(path + "/from-bank", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).header("Idempotency-Key", "bank-poll-once")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionId\":\"" + bank.get("id").asText() + "\"}");
        assertEquals(json(fromBank, 201).at("/poll/id"), json(fromBank, 201).at("/poll/id"));
        assertEquals(2, count("interaction.quick_polls"));
    }

    @Test
    void sessionCreateReplaysAndFreshCourseAccessStillApplies() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        var request = post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken).header("Idempotency-Key", "session-once")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}");
        var first = json(request, 201);
        assertEquals(first.get("id"), json(request, 201).get("id"));
        assertEquals(2, count("live.sessions"));
        jdbc.sql("delete from org.course_members where course_id = :id").param("id", courseId).update();
        json(request, 403);
        assertEquals(2, count("live.sessions"));
    }

    @Test
    void coursesAndGroupsSupportOneKeyPerCreateIntent() throws Exception {
        var course = post("/api/v1/courses").header("Authorization", "Bearer " + lecturerToken)
                .header("Idempotency-Key", "course-once").contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"New course\"}");
        var created = json(course, 201);
        assertEquals(created.get("id"), json(course, 201).get("id"));
        var group = post("/api/v1/courses/{c}/groups", courseId)
                .header("Authorization", "Bearer " + lecturerToken).header("Idempotency-Key", "group-once")
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"New group\"}");
        assertEquals(json(group, 201).get("id"), json(group, 201).get("id"));
        assertEquals(1, count("org.study_groups where name = 'New group'"));
    }

}
