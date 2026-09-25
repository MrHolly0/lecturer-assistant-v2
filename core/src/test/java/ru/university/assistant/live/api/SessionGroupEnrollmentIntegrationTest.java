package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class SessionGroupEnrollmentIntegrationTest extends LiveFlowTestBase {

    @Test
    void repeatedLectureStartsKeepIndependentCodesAndGroupSnapshots() throws Exception {
        String firstCode = joinCode;
        end(sessionId);

        JsonNode repeated = start(lectureId, "{\"groups\":[{\"groupId\":\"" + groupId
                + "\"},{\"groupName\":\"Группа Б\"}]}");
        UUID repeatedId = UUID.fromString(repeated.get("id").asText());
        assertNotEquals(firstCode, repeated.get("joinCode").asText());
        assertEquals(2, repeated.get("groups").size());

        JsonNode snapshot = json(get("/api/v1/student/sessions/{code}", repeated.get("joinCode").asText()), 200);
        assertEquals("Algorithms", snapshot.get("courseTitle").asText());
        assertEquals(2, snapshot.get("groups").size());

        end(repeatedId);
        JsonNode history = json(get("/api/v1/courses/{c}/sessions", courseId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, history.get("items").get(0).get("groups").size());
        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, repeatedId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, summary.get("groups").size());

        UUID secondGroup = UUID.fromString(repeated.get("groups").get(1).get("id").asText());
        json(delete("/api/v1/courses/{c}/groups/{g}", courseId, secondGroup)
                .header("Authorization", "Bearer " + lecturerToken), 409);
    }

    @Test
    void maxStudentSelectsOneOfManyGroupsAndRepeatedJoinIsIdempotent() throws Exception {
        JsonNode multi = start(lectureId, "{\"groups\":[{\"groupId\":\"" + groupId
                + "\"},{\"groupName\":\"Группа Б\"}]}");
        sessionId = UUID.fromString(multi.get("id").asText());
        joinCode = multi.get("joinCode").asText();
        UUID secondGroup = UUID.fromString(multi.get("groups").get(1).get("id").asText());
        String jwt = maxLogin(2101);
        UUID personId = UUID.fromString(personIdOf(jwt));

        JsonNode required = json(post("/api/v1/student/sessions/{code}/join", joinCode)
                .header("Authorization", "Bearer " + jwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 409);
        assertEquals("GROUP_SELECTION_REQUIRED", required.get("error").asText());
        assertEquals(2, required.get("allowedGroups").size());
        assertEquals(0, count("org.course_members where person_id = '" + personId + "'"));
        assertEquals(0, count("live.session_participants where person_id = '" + personId + "'"));

        JsonNode joined = json(post("/api/v1/student/sessions/{code}/join", joinCode)
                .header("Authorization", "Bearer " + jwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groupId\":\"" + secondGroup + "\"}"), 200);
        assertEquals("PROFILE", joined.get("identityLevel").asText());
        assertEquals(1, count("org.course_members where person_id = '" + personId + "'"));
        assertEquals(1, count("org.group_members where person_id = '" + personId
                + "' and group_id = '" + secondGroup + "'"));
        assertEquals(1, count("live.session_participants where person_id = '" + personId
                + "' and group_id = '" + secondGroup + "'"));

        join(jwt, null);
        assertEquals(1, count("live.session_participants where person_id = '" + personId + "'"));
        assertEquals(1, count("analytics.events where verb = 'participant.joined' and actor_person_id = '"
                + personId + "'"));
    }

    @Test
    void groupMismatchDoesNotMoveOrJoinStudent() throws Exception {
        String jwt = maxLogin(2201);
        join(jwt, null);
        UUID personId = UUID.fromString(personIdOf(jwt));
        UUID secondGroup = createGroup("Группа Б");
        JsonNode other = start(lectureId, "{\"groups\":[{\"groupId\":\"" + secondGroup + "\"}]}");
        String otherCode = other.get("joinCode").asText();
        UUID otherSession = UUID.fromString(other.get("id").asText());
        long joinedEvents = count("analytics.events where verb = 'participant.joined'");

        JsonNode mismatch = json(post("/api/v1/student/sessions/{code}/join", otherCode)
                .header("Authorization", "Bearer " + jwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 409);
        assertEquals("GROUP_MISMATCH", mismatch.get("error").asText());
        assertEquals(groupId.toString(), mismatch.at("/currentGroup/id").asText());
        assertEquals(0, count("live.session_participants where session_id = '" + otherSession
                + "' and person_id = '" + personId + "'"));
        assertEquals(joinedEvents, count("analytics.events where verb = 'participant.joined'"));
        assertEquals(1, count("org.group_members where group_id = '" + groupId
                + "' and person_id = '" + personId + "'"));
    }

    @Test
    void movingStudentAffectsOnlyFutureSessionAnalytics() throws Exception {
        String jwt = maxLogin(2301);
        UUID personId = UUID.fromString(personIdOf(jwt));
        join(jwt, null);
        signal(jwt, "RED");
        end(sessionId);

        UUID secondGroup = createGroup("Группа Б");
        json(put("/api/v1/courses/{c}/groups/{g}/members/{p}", courseId, secondGroup, personId)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        JsonNode future = start(lectureId, "{\"groups\":[{\"groupId\":\"" + secondGroup + "\"}]}");
        sessionId = UUID.fromString(future.get("id").asText());
        joinCode = future.get("joinCode").asText();
        join(jwt, null);
        signal(jwt, "GREEN");
        end(sessionId);

        JsonNode analytics = json(get("/api/v1/courses/{c}/analytics/groups", courseId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, group(analytics, groupId).at("/metrics/redSignals").asInt());
        assertEquals(0, group(analytics, groupId).at("/metrics/greenSignals").asInt());
        assertEquals(1, group(analytics, secondGroup).at("/metrics/greenSignals").asInt());
        assertEquals(0, group(analytics, secondGroup).at("/metrics/redSignals").asInt());
    }

    @Test
    void guestSelectsGroupWithoutEnteringPermanentRoster() throws Exception {
        JsonNode multi = start(lectureId, "{\"groups\":[{\"groupId\":\"" + groupId
                + "\"},{\"groupName\":\"Группа Б\"}]}");
        joinCode = multi.get("joinCode").asText();
        UUID secondGroup = UUID.fromString(multi.get("groups").get(1).get("id").asText());

        JsonNode required = json(post("/api/v1/student/sessions/{code}/join", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Гость\"}"), 409);
        assertEquals("GROUP_SELECTION_REQUIRED", required.get("error").asText());
        assertEquals(0, count("iam.persons where status = 'EPHEMERAL'"));

        json(post("/api/v1/student/sessions/{code}/join", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Гость\",\"groupId\":\"" + secondGroup + "\"}"), 200);
        assertEquals(1, count("live.session_participants where group_id = '" + secondGroup + "'"));
        assertEquals(0, count("org.course_members where role = 'STUDENT'"));
        assertEquals(0, count("org.group_members"));
    }

    @Test
    void invalidAndEndedCodesCannotBeJoined() throws Exception {
        json(post("/api/v1/student/sessions/NOPE00/join")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 404);
        end(sessionId);
        json(post("/api/v1/student/sessions/{code}/join", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 409);
    }

    @Test
    void concurrentMaxJoinLeavesOneParticipantMembershipAndProfileToken() throws Exception {
        String jwt = maxLogin(2401);
        UUID personId = UUID.fromString(personIdOf(jwt));

        CompletableFuture<Integer> first = CompletableFuture.supplyAsync(() -> joinStatus(jwt));
        CompletableFuture<Integer> second = CompletableFuture.supplyAsync(() -> joinStatus(jwt));
        assertEquals(200, first.get());
        assertEquals(200, second.get());
        assertEquals(1, count("live.session_participants where person_id = '" + personId + "'"));
        assertEquals(1, count("org.course_members where person_id = '" + personId + "'"));
        assertEquals(1, count("org.group_members where person_id = '" + personId + "'"));
        assertEquals(1, count("live.web_participant_tokens where person_id = '" + personId + "'"));
    }

    private int joinStatus(String jwt) {
        try {
            return mockMvc.perform(post("/api/v1/student/sessions/{code}/join", joinCode)
                            .header("Authorization", "Bearer " + jwt)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andReturn()
                    .getResponse()
                    .getStatus();
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private JsonNode start(String lecture, String body) throws Exception {
        return json(post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lecture)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), 201);
    }

    private UUID createGroup(String name) throws Exception {
        return UUID.fromString(json(post("/api/v1/courses/{c}/groups", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\"}"), 201)
                .get("id")
                .asText());
    }

    private void end(UUID session) throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private void signal(String jwt, String value) throws Exception {
        json(post("/api/v1/student/sessions/{code}/signals", joinCode)
                .header("Authorization", "Bearer " + jwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":\"" + value + "\"}"), 200);
    }

    private JsonNode group(JsonNode response, UUID id) {
        for (JsonNode group : response.get("groups")) {
            if (id.toString().equals(group.get("groupId").asText())) {
                return group;
            }
        }
        throw new AssertionError("Group not found: " + id);
    }
}
