package ru.university.assistant.live.api;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import ru.university.assistant.org.api.GroupMismatchException;
import ru.university.assistant.org.api.GroupSelectionRequiredException;
import ru.university.assistant.org.api.StudyGroup;

@RestControllerAdvice
class GroupMismatchExceptionHandler {
    @ExceptionHandler(GroupMismatchException.class)
    ResponseEntity<Map<String, Object>> handle(GroupMismatchException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of(
                        "error", "GROUP_MISMATCH",
                        "currentGroup", group(exception.currentGroup()),
                        "allowedGroups", exception.allowedGroups().stream().map(this::group).toList()));
    }

    @ExceptionHandler(GroupSelectionRequiredException.class)
    ResponseEntity<Map<String, Object>> handle(GroupSelectionRequiredException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of(
                        "error", "GROUP_SELECTION_REQUIRED",
                        "allowedGroups", exception.allowedGroups().stream().map(this::group).toList()));
    }

    private Map<String, Object> group(StudyGroup group) {
        return Map.of("id", group.id(), "name", group.name());
    }
}
