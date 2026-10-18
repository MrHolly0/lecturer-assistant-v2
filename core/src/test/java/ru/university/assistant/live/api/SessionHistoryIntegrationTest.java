package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import ru.university.assistant.shared.api.UuidV7;

class SessionHistoryIntegrationTest extends LiveFlowTestBase {

    @Test
    void emptyHistoryDoesNotIncludeActiveSession() throws Exception {
        JsonNode history = history(courseId, lecturerToken, 20, 0, 200);

        assertEquals(0, history.get("total").asInt());
        assertEquals(0, history.get("items").size());
    }

    @Test
    void historyIsPaginatedScopedAndKeepsRepeatedLecturePollResults() throws Exception {
        UUID firstSessionId = sessionId;
        UUID pollId = startAndClosePoll(firstSessionId);
        end(firstSessionId);

        JsonNode repeated = json(post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}"), 201);
        UUID secondSessionId = UUID.fromString(repeated.get("id").asText());
        begin(secondSessionId);
        end(secondSessionId);

        JsonNode active = json(post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}"), 201);
        UUID activeSessionId = UUID.fromString(active.get("id").asText());
        UUID otherCourseSessionId = createCompletedSessionInAnotherCourse();

        jdbc.sql("update live.sessions set ended_at = now() - interval '2 hours' where id = :id")
                .param("id", firstSessionId)
                .update();
        jdbc.sql("update live.sessions set ended_at = now() - interval '1 hour' where id = :id")
                .param("id", secondSessionId)
                .update();

        JsonNode firstPage = history(courseId, lecturerToken, 1, 0, 200);
        assertEquals(2, firstPage.get("total").asInt());
        assertEquals(1, firstPage.get("items").size());
        assertEquals(secondSessionId.toString(), firstPage.get("items").get(0).get("id").asText());
        assertEquals(lectureId.toString(), firstPage.get("items").get(0).get("lectureId").asText());
        assertEquals("ENDED", firstPage.get("items").get(0).get("status").asText());

        JsonNode secondPage = history(courseId, lecturerToken, 1, 1, 200);
        assertEquals(firstSessionId.toString(), secondPage.get("items").get(0).get("id").asText());
        assertEquals(lectureId.toString(), secondPage.get("items").get(0).get("lectureId").asText());
        assertFalse(secondPage.toString().contains(activeSessionId.toString()));
        assertFalse(secondPage.toString().contains(otherCourseSessionId.toString()));

        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, firstSessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, summary.get("pollResults").size());
        assertEquals(pollId.toString(), summary.get("pollResults").get(0).get("pollId").asText());
    }

    @Test
    void historyRequiresCourseManagementAndValidPagination() throws Exception {
        String studentJwt = maxLogin(818);

        history(courseId, studentJwt, 20, 0, 403);
        history(courseId, lecturerToken, 0, 0, 400);
        history(courseId, lecturerToken, 101, 0, 400);
        history(courseId, lecturerToken, 20, -1, 400);
        historyWith(courseId, lecturerToken, "x".repeat(201), null, null, null, 20, 0, 400);
        historyWith(courseId, lecturerToken, null, null,
                "2026-10-17T10:00:00Z", "2026-10-17T10:00:00Z", 20, 0, 400);
    }

    @Test
    void historyFiltersSnapshotsAndEndTimeBeforePagination() throws Exception {
        UUID firstSessionId = sessionId;
        end(firstSessionId);
        JsonNode second = schedule("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}");
        UUID secondSessionId = UUID.fromString(second.get("id").asText());
        begin(secondSessionId);
        end(secondSessionId);

        JsonNode third = schedule("{\"groups\":[{\"groupName\":\"Historical group\"}]}");
        UUID thirdSessionId = UUID.fromString(third.get("id").asText());
        UUID historicalGroupId = UUID.fromString(third.get("groups").get(0).get("id").asText());
        begin(thirdSessionId);
        end(thirdSessionId);
        JsonNode fourth = schedule("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}");
        UUID fourthSessionId = UUID.fromString(fourth.get("id").asText());
        begin(fourthSessionId);
        end(fourthSessionId);

        Instant firstEnd = Instant.parse("2026-10-17T10:00:00Z");
        Instant secondEnd = Instant.parse("2026-10-17T10:30:00Z");
        Instant thirdEnd = Instant.parse("2026-10-17T11:00:00Z");
        Instant fourthEnd = Instant.parse("2026-10-17T11:30:00Z");
        setEndedAt(firstSessionId, firstEnd);
        setEndedAt(secondSessionId, secondEnd);
        setEndedAt(thirdSessionId, thirdEnd);
        setEndedAt(fourthSessionId, fourthEnd);
        jdbc.sql("update live.session_groups set group_name_snapshot = 'Legacy 100%_group' "
                        + "where session_id in (:first, :second)")
                .param("first", firstSessionId)
                .param("second", secondSessionId)
                .update();
        jdbc.sql("update live.session_groups set group_name_snapshot = 'Latest historical name' "
                        + "where session_id = :sessionId and group_id = :groupId")
                .param("sessionId", fourthSessionId)
                .param("groupId", groupId)
                .update();
        jdbc.sql("update live.lectures set title = 'Graphs & search' where id = :id")
                .param("id", UUID.fromString(lectureId))
                .update();
        jdbc.sql("update org.study_groups set name = 'Current renamed group' where id = :id")
                .param("id", historicalGroupId)
                .update();

        JsonNode page = historyWith(
                courseId,
                lecturerToken,
                "100%_",
                groupId,
                firstEnd.toString(),
                thirdEnd.toString(),
                1,
                1,
                200);
        assertEquals(2, page.get("total").asInt());
        assertEquals(1, page.get("items").size());
        assertEquals(firstSessionId.toString(), page.get("items").get(0).get("id").asText());

        JsonNode renamedGroup = historyWith(
                courseId, lecturerToken, "historical", historicalGroupId, null, null, 20, 0, 200);
        assertEquals(1, renamedGroup.get("total").asInt());
        assertEquals(thirdSessionId.toString(), renamedGroup.get("items").get(0).get("id").asText());

        JsonNode fromBoundary = historyWith(
                courseId, lecturerToken, "Graphs", null, thirdEnd.toString(), fourthEnd.toString(), 20, 0, 200);
        assertEquals(1, fromBoundary.get("total").asInt());
        assertEquals(thirdSessionId.toString(), fromBoundary.get("items").get(0).get("id").asText());
        JsonNode beforeBoundary = historyWith(
                courseId, lecturerToken, null, null, null, thirdEnd.toString(), 20, 0, 200);
        assertEquals(2, beforeBoundary.get("total").asInt());
        assertFalse(beforeBoundary.toString().contains(thirdSessionId.toString()));

        JsonNode availableGroups = page.get("availableGroups");
        assertEquals(2, availableGroups.size());
        assertEquals(historicalGroupId.toString(), availableGroupId(availableGroups, historicalGroupId));
        assertEquals("Historical group", availableGroupName(availableGroups, historicalGroupId));
        assertEquals("Latest historical name", availableGroupName(availableGroups, groupId));
        assertFalse(availableGroups.toString().contains("Current renamed group"));
    }

    @Test
    void historySearchMatchesLectureTitleAndKeepsHistoricalGroupOptionsUnfiltered() throws Exception {
        end(sessionId);
        jdbc.sql("update live.lectures set title = 'Searchable Lecture' where id = :id")
                .param("id", UUID.fromString(lectureId))
                .update();
        JsonNode filtered = historyWith(
                courseId, lecturerToken, "searchable", null, null, null, 20, 0, 200);
        assertEquals(1, filtered.get("total").asInt());
        assertEquals(1, filtered.get("availableGroups").size());
        assertEquals(groupId.toString(), filtered.get("availableGroups").get(0).get("id").asText());
    }

    private JsonNode history(UUID course, String token, int limit, int offset, int expected) throws Exception {
        return historyWith(course, token, null, null, null, null, limit, offset, expected);
    }

    private JsonNode historyWith(
            UUID course,
            String token,
            String query,
            UUID groupFilter,
            String endedFrom,
            String endedBefore,
            int limit,
            int offset,
            int expected) throws Exception {
        var request = get("/api/v1/courses/{c}/sessions", course)
                .queryParam("limit", String.valueOf(limit))
                .queryParam("offset", String.valueOf(offset))
                .header("Authorization", "Bearer " + token);
        if (query != null) request.queryParam("query", query);
        if (groupFilter != null) request.queryParam("groupId", groupFilter.toString());
        if (endedFrom != null) request.queryParam("endedFrom", endedFrom);
        if (endedBefore != null) request.queryParam("endedBefore", endedBefore);
        return json(request, expected);
    }

    private JsonNode schedule(String body) throws Exception {
        return json(post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), 201);
    }

    private void setEndedAt(UUID sessionId, Instant endedAt) {
        jdbc.sql("update live.sessions set ended_at = :endedAt where id = :id")
                .param("endedAt", java.sql.Timestamp.from(endedAt))
                .param("id", sessionId)
                .update();
    }

    private String availableGroupId(JsonNode groups, UUID groupId) {
        return groups.findValues("id").stream()
                .map(JsonNode::asText)
                .filter(groupId.toString()::equals)
                .findFirst()
                .orElse("");
    }

    private String availableGroupName(JsonNode groups, UUID groupId) {
        for (JsonNode group : groups) {
            if (groupId.toString().equals(group.get("id").asText())) return group.get("name").asText();
        }
        return "";
    }

    private UUID startAndClosePoll(UUID session) throws Exception {
        JsonNode started = json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Что сохранилось?\",\"options\":[\"A\",\"B\"]}"), 201);
        UUID pollId = UUID.fromString(started.get("poll").get("id").asText());
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, session, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":0}"), 200);
        return pollId;
    }

    private void end(UUID session) throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private UUID createCompletedSessionInAnotherCourse() throws Exception {
        UUID otherCourseId = UUID.fromString(json(post("/api/v1/courses")
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Other course\"}"), 201)
                .get("id")
                .asText());
        UUID createdBy = UUID.fromString(personIdOf(lecturerToken));
        UUID otherDeckId = UuidV7.generate();
        UUID otherLectureId = UuidV7.generate();
        UUID otherSessionId = UuidV7.generate();
        jdbc.sql("""
                        insert into content.slide_decks
                            (id, course_id, title, version, source_file_ref, source_filename,
                             source_content_type, source_size_bytes)
                        values (:id, :courseId, 'Other deck', 1, 'test', 'other.pdf', 'application/pdf', 0)
                        """)
                .param("id", otherDeckId)
                .param("courseId", otherCourseId)
                .update();
        jdbc.sql("""
                        insert into live.lectures (id, course_id, title, deck_id, created_by)
                        values (:id, :courseId, 'Other lecture', :deckId, :createdBy)
                        """)
                .param("id", otherLectureId)
                .param("courseId", otherCourseId)
                .param("deckId", otherDeckId)
                .param("createdBy", createdBy)
                .update();
        jdbc.sql("""
                        insert into live.sessions
                            (id, lecture_id, deck_id, status, join_code, started_at, ended_at, created_by)
                        values (:id, :lectureId, :deckId, 'ENDED', 'OTHER1',
                                now() - interval '1 hour', now(), :createdBy)
                        """)
                .param("id", otherSessionId)
                .param("lectureId", otherLectureId)
                .param("deckId", otherDeckId)
                .param("createdBy", createdBy)
                .update();
        return otherSessionId;
    }
}
