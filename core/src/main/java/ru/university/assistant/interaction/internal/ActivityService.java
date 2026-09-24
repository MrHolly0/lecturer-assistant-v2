package ru.university.assistant.interaction.internal;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.interaction.api.ActivityDefinition;
import ru.university.assistant.interaction.api.ActivityRespondApi;
import ru.university.assistant.interaction.api.ActivityResponse;
import ru.university.assistant.interaction.api.ActivityRun;
import ru.university.assistant.interaction.api.ActivityRunStatus;
import ru.university.assistant.interaction.api.ActivityStrategy;
import ru.university.assistant.interaction.api.CreateActivityRequest;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class ActivityService implements ActivityRespondApi {
    private static final Random RANDOM = new Random();

    private final ActivityRepository activities;
    private final LiveSessionAccessApi liveSessions;

    ActivityService(ActivityRepository activities, LiveSessionAccessApi liveSessions) {
        this.activities = activities;
        this.liveSessions = liveSessions;
    }

    @Transactional
    public ActivityDefinition createDefinition(UUID courseId, UUID createdBy,
            CreateActivityRequest request) {
        return activities.createDefinition(UuidV7.generate(), courseId, createdBy,
                request.title(), request.questionIds(), request.strategy(), request.strategyN());
    }

    public ActivityDefinition getDefinition(UUID courseId, UUID definitionId) {
        return activities.findDefinitionByIdAndCourse(definitionId, courseId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Activity definition not found"));
    }

    public List<ActivityDefinition> listDefinitions(UUID courseId) {
        return activities.findDefinitionsByCourse(courseId);
    }

    @Transactional
    public ActivityRun startRun(UUID courseId, UUID sessionId, UUID definitionId) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        ActivityDefinition def = getDefinition(courseId, definitionId);
        List<UUID> questionIds = selectQuestions(def);
        return activities.createRun(UuidV7.generate(), definitionId, sessionId, questionIds);
    }

    @Transactional
    public ActivityRun closeRun(UUID courseId, UUID sessionId, UUID runId) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        runInSession(sessionId, runId);
        return activities.closeRun(runId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Activity run not found or already closed"));
    }

    @Transactional
    @Override
    public ActivityResponse submitResponse(UUID sessionId, UUID runId, UUID personId, UUID questionId,
            JsonNode answer) {
        ActivityRun run = runInSession(sessionId, runId);
        if (run.status() == ActivityRunStatus.CLOSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Activity run is already closed");
        }
        if (!run.questionIds().contains(questionId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Question not part of this activity run");
        }
        return activities.submitResponse(UuidV7.generate(), runId, personId, questionId, answer);
    }

    public List<ActivityResponse> getResponses(UUID courseId, UUID sessionId, UUID runId) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        runInSession(sessionId, runId);
        return activities.findResponsesByRun(runId);
    }

    // D-09/D-10 одним приёмом: прогон обязан принадлежать той самой сессии, что названа в пути,
    // а сессия (там, где это преподавательский путь) — тому самому курсу.
    private ActivityRun runInSession(UUID sessionId, UUID runId) {
        return activities.findRunById(runId)
                .filter(found -> found.sessionId().equals(sessionId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Activity run not found"));
    }

    private List<UUID> selectQuestions(ActivityDefinition def) {
        if (def.strategy() == ActivityStrategy.ALL || def.questionIds().isEmpty()) {
            return def.questionIds();
        }
        if (def.strategy() == ActivityStrategy.RANDOM_N && def.strategyN() != null) {
            List<UUID> shuffled = new ArrayList<>(def.questionIds());
            Collections.shuffle(shuffled, RANDOM);
            int n = Math.min(def.strategyN(), shuffled.size());
            return shuffled.subList(0, n);
        }
        return def.questionIds();
    }
}
