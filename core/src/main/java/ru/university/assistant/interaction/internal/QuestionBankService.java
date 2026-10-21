package ru.university.assistant.interaction.internal;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.interaction.api.CreateQuestionRequest;
import ru.university.assistant.interaction.api.QuestionBankEntry;
import ru.university.assistant.interaction.api.QuestionOption;
import ru.university.assistant.interaction.api.QuestionType;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class QuestionBankService {
    private final QuestionBankRepository questions;

    QuestionBankService(QuestionBankRepository questions) {
        this.questions = questions;
    }

    @Transactional
    public QuestionBankEntry create(UUID courseId, UUID createdBy, CreateQuestionRequest request) {
        List<String> tags = request.tags() == null ? List.of() : request.tags();
        QuestionBankEntry created = questions.create(UuidV7.generate(), courseId, createdBy,
                request.text(), request.questionType(), options(request.questionType(), request.options()), tags);
        saveLinks(courseId, created.id(), request.lectureIds());
        return get(courseId, created.id());
    }

    // D-10: вопрос обязан принадлежать курсу из пути, иначе чужой преподаватель мог прочитать
    // (а через update/archive — и поменять) содержимое банка вопросов другого курса вместе
    // с правильными ответами, зная только id вопроса.
    public QuestionBankEntry get(UUID courseId, UUID id) {
        return questions.findByIdAndCourse(id, courseId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
    }

    public List<QuestionBankEntry> list(UUID courseId, String tag) {
        return questions.findByCourse(courseId, tag);
    }

    @Transactional
    public QuestionBankEntry update(UUID courseId, UUID id, CreateQuestionRequest request) {
        List<String> tags = request.tags() == null ? List.of() : request.tags();
        lock(courseId, id);
        QuestionBankEntry saved = get(courseId, id);
        if (saved.questionType() != request.questionType()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Question type cannot be changed");
        }
        questions.update(id, courseId, request.text(), options(saved.questionType(), request.options()), tags)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
        saveLinks(courseId, id, request.lectureIds());
        return get(courseId, id);
    }

    @Transactional
    public QuestionBankEntry link(UUID courseId, UUID id, UUID lectureId) {
        lock(courseId, id);
        requireLecture(courseId, lectureId);
        questions.link(courseId, id, lectureId);
        return get(courseId, id);
    }

    @Transactional
    public void unlink(UUID courseId, UUID id, UUID lectureId) {
        lock(courseId, id);
        requireLecture(courseId, lectureId);
        questions.unlink(courseId, id, lectureId);
    }

    private void lock(UUID courseId, UUID id) {
        if (!questions.lock(courseId, id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found");
        }
    }

    private void requireLecture(UUID courseId, UUID lectureId) {
        if (!questions.lectureExists(courseId, lectureId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found");
        }
    }

    private void saveLinks(UUID courseId, UUID id, List<UUID> lectureIds) {
        // Older clients omit this property; editing text must preserve existing links.
        if (lectureIds == null) return;
        lectureIds.forEach(lectureId -> requireLecture(courseId, lectureId));
        questions.replaceLinks(courseId, id, lectureIds);
    }

    private List<QuestionOption> options(QuestionType type, List<QuestionOption> options) {
        if (type == QuestionType.SHORT_ANSWER) return List.of();
        if (options == null || options.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Answer options are required");
        }
        return options;
    }

    @Transactional
    public void archive(UUID courseId, UUID id) {
        if (!questions.archive(id, courseId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found");
        }
    }
}
