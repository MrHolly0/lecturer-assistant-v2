package ru.university.assistant.interaction.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.interaction.internal.QuestionBankService;
import ru.university.assistant.org.api.CourseAccessApi;

@RestController
@RequestMapping("/api/v1/courses/{courseId}/questions")
class QuestionBankController {
    private final QuestionBankService service;
    private final CourseAccessApi courseAccess;

    QuestionBankController(QuestionBankService service, CourseAccessApi courseAccess) {
        this.service = service;
        this.courseAccess = courseAccess;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public QuestionBankEntry create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody CreateQuestionRequest request) {
        courseAccess.requireManage(user, courseId);
        return service.create(courseId, user.id(), request);
    }

    @GetMapping
    public List<QuestionBankEntry> list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @RequestParam(required = false) String tag) {
        courseAccess.requireManage(user, courseId);
        return service.list(courseId, tag);
    }

    @GetMapping("/{questionId}")
    public QuestionBankEntry get(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID questionId) {
        courseAccess.requireManage(user, courseId);
        return service.get(questionId);
    }

    @PutMapping("/{questionId}")
    public QuestionBankEntry update(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID questionId,
            @Valid @RequestBody CreateQuestionRequest request) {
        courseAccess.requireManage(user, courseId);
        return service.update(questionId, request);
    }

    @DeleteMapping("/{questionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID questionId) {
        courseAccess.requireManage(user, courseId);
        service.archive(questionId);
    }
}
