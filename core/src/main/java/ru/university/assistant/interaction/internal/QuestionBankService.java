package ru.university.assistant.interaction.internal;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.interaction.api.CreateQuestionRequest;
import ru.university.assistant.interaction.api.QuestionBankEntry;
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
        return questions.create(UuidV7.generate(), courseId, createdBy,
                request.text(), request.questionType(), request.options(), tags);
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
        return questions.update(id, courseId, request.text(), request.options(), tags)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
    }

    @Transactional
    public void archive(UUID courseId, UUID id) {
        if (!questions.archive(id, courseId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found");
        }
    }
}
