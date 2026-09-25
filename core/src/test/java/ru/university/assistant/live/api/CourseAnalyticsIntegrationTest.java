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

class CourseAnalyticsIntegrationTest extends LiveFlowTestBase {

    @Test
    void analyticsSeparatesCurrentGroupsUngroupedAndUnidentifiedWithHonestDenominators() throws Exception {
        StudentFixture first = profileStudent(1101);
        StudentFixture second = profileStudent(1102);
        String guestToken = join(null, "{\"displayName\":\"Гость\"}").get("participantToken").asText();
        UUID firstGroup = groupId;

        signal(first.jwt(), null, "RED");
        signal(second.jwt(), null, "GREEN");
        signal(null, guestToken, "YELLOW");
        question(first.jwt(), null, "Профильный вопрос");
        question(null, guestToken, "Гостевой вопрос");

        UUID gradedPoll = startPoll();
        vote(gradedPoll, first.jwt(), null, 0);
        vote(gradedPoll, second.jwt(), null, 1);
        vote(gradedPoll, null, guestToken, 0);
        closePoll(gradedPoll, 0);
        UUID ungradedPoll = startPoll();
        vote(ungradedPoll, first.jwt(), null, 1);
        closePoll(ungradedPoll, null);
        UUID openPoll = startPoll();
        vote(openPoll, first.jwt(), null, 0);

        JsonNode analytics = json(get("/api/v1/courses/{c}/analytics/groups", courseId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, analytics.at("/overall/memberCount").asInt());
        assertEquals(2, analytics.at("/overall/participantCount").asInt());
        assertEquals(2, analytics.at("/overall/signalCount").asInt());
        assertEquals(3, analytics.at("/overall/checkAnswers").asInt());
        assertEquals(2, analytics.at("/overall/gradedAnswers").asInt());
        assertEquals(1, analytics.at("/overall/correctAnswers").asInt());
        assertEquals(0.5, analytics.at("/overall/correctRate").asDouble());
        assertEquals(1, analytics.at("/overall/questionsAsked").asInt());

        JsonNode groupOne = group(analytics, firstGroup);
        assertEquals(2, groupOne.at("/metrics/memberCount").asInt());
        assertEquals(1, groupOne.at("/metrics/redSignals").asInt());
        assertEquals(1, groupOne.at("/metrics/greenSignals").asInt());
        assertEquals(3, groupOne.at("/metrics/checkAnswers").asInt());
        assertEquals(2, groupOne.at("/metrics/gradedAnswers").asInt());
        assertEquals(0.5, groupOne.at("/metrics/correctRate").asDouble());
        assertEquals(0, analytics.at("/ungrouped/memberCount").asInt());
        assertEquals(0, analytics.at("/unidentified/memberCount").asInt());
        assertEquals(1, analytics.at("/unidentified/participantCount").asInt());
        assertEquals(1, analytics.at("/unidentified/yellowSignals").asInt());
        assertEquals(1, analytics.at("/unidentified/questionsAsked").asInt());

        JsonNode page = json(get("/api/v1/courses/{c}/analytics/students", courseId)
                .queryParam("limit", "1")
                .queryParam("offset", "0")
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, page.get("total").asInt());
        assertEquals(1, page.get("items").size());

        JsonNode student = json(get("/api/v1/courses/{c}/analytics/students/{p}", courseId, first.personId())
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(first.personId().toString(), student.get("personId").asText());
        assertEquals(1, student.get("groups").size());
        assertEquals(2, student.at("/metrics/checkAnswers").asInt());
        assertEquals(1, student.at("/metrics/gradedAnswers").asInt());
    }

    @Test
    void analyticsAndGroupMembershipAreManageOnlyCourseScopedAndBounded() throws Exception {
        StudentFixture student = profileStudent(1201);
        UUID firstGroup = createGroup("AA");
        UUID secondGroup = createGroup("BB");

        assign(firstGroup, student.personId());
        assertEquals(1, groupMembers(firstGroup, lecturerToken, 200).size());
        assign(secondGroup, student.personId());
        assertEquals(0, groupMembers(firstGroup, lecturerToken, 200).size());
        assertEquals(1, groupMembers(secondGroup, lecturerToken, 200).size());
        json(delete("/api/v1/courses/{c}/groups/{g}/members/{p}",
                        courseId, secondGroup, student.personId())
                .header("Authorization", "Bearer " + lecturerToken), 204);
        assertEquals(0, groupMembers(secondGroup, lecturerToken, 200).size());

        json(get("/api/v1/courses/{c}/analytics/groups", courseId)
                .header("Authorization", "Bearer " + student.jwt()), 403);
        json(get("/api/v1/courses/{c}/groups/{g}/members", courseId, firstGroup)
                .header("Authorization", "Bearer " + student.jwt()), 403);
        json(get("/api/v1/courses/{c}/analytics/students", courseId)
                .queryParam("limit", "0")
                .header("Authorization", "Bearer " + lecturerToken), 400);
        json(get("/api/v1/courses/{c}/analytics/students", courseId)
                .queryParam("limit", "101")
                .header("Authorization", "Bearer " + lecturerToken), 400);
        json(get("/api/v1/courses/{c}/analytics/students", courseId)
                .queryParam("offset", "-1")
                .header("Authorization", "Bearer " + lecturerToken), 400);

        UUID otherCourseId = UUID.fromString(json(post("/api/v1/courses")
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Other\"}"), 201)
                .get("id")
                .asText());
        json(get("/api/v1/courses/{c}/analytics/students/{p}", otherCourseId, student.personId())
                .header("Authorization", "Bearer " + lecturerToken), 404);
        json(get("/api/v1/courses/{c}/analytics/students", courseId)
                .queryParam("groupId", UUID.randomUUID().toString())
                .header("Authorization", "Bearer " + lecturerToken), 404);
    }

    private StudentFixture profileStudent(long externalId) throws Exception {
        String jwt = maxLogin(externalId);
        join(jwt, null);
        return new StudentFixture(jwt, UUID.fromString(personIdOf(jwt)));
    }

    private UUID createGroup(String name) throws Exception {
        return UUID.fromString(json(post("/api/v1/courses/{c}/groups", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\"}"), 201)
                .get("id")
                .asText());
    }

    private void assign(UUID groupId, UUID personId) throws Exception {
        json(put("/api/v1/courses/{c}/groups/{g}/members/{p}", courseId, groupId, personId)
                .header("Authorization", "Bearer " + lecturerToken), 204);
    }

    private JsonNode groupMembers(UUID groupId, String token, int expected) throws Exception {
        return json(get("/api/v1/courses/{c}/groups/{g}/members", courseId, groupId)
                .header("Authorization", "Bearer " + token), expected);
    }

    private void signal(String jwt, String token, String value) throws Exception {
        var request = post("/api/v1/student/sessions/{code}/signals", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":\"" + value + "\""
                        + (token == null ? "}" : ",\"participantToken\":\"" + token + "\"}"));
        if (jwt != null) request.header("Authorization", "Bearer " + jwt);
        json(request, 200);
    }

    private void question(String jwt, String token, String text) throws Exception {
        var request = post("/api/v1/student/sessions/{code}/questions", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"" + text + "\""
                        + (token == null ? "}" : ",\"participantToken\":\"" + token + "\"}"));
        if (jwt != null) request.header("Authorization", "Bearer " + jwt);
        json(request, 201);
    }

    private UUID startPoll() throws Exception {
        return UUID.fromString(json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"questionText\":\"Проверка\",\"options\":[\"A\",\"B\"]}"), 201)
                .at("/poll/id")
                .asText());
    }

    private void vote(UUID pollId, String jwt, String token, int option) throws Exception {
        var request = post("/api/v1/student/sessions/{code}/polls/{poll}/respond", joinCode, pollId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"optionIdx\":" + option
                        + (token == null ? "}" : ",\"participantToken\":\"" + token + "\"}"));
        if (jwt != null) request.header("Authorization", "Bearer " + jwt);
        json(request, 200);
    }

    private void closePoll(UUID pollId, Integer correct) throws Exception {
        var request = post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken);
        if (correct != null) {
            request.contentType(MediaType.APPLICATION_JSON)
                    .content("{\"correctOptionIdx\":" + correct + "}");
        }
        json(request, 200);
    }

    private JsonNode group(JsonNode response, UUID groupId) {
        for (JsonNode group : response.get("groups")) {
            if (groupId.toString().equals(group.get("groupId").asText())) return group;
        }
        throw new AssertionError("Group not found: " + groupId);
    }

    private record StudentFixture(String jwt, UUID personId) {}
}
