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

    public QuestionBankEntry get(UUID id) {
        return questions.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
    }

    public List<QuestionBankEntry> list(UUID courseId, String tag) {
        return questions.findByCourse(courseId, tag);
    }

    @Transactional
    public QuestionBankEntry update(UUID id, CreateQuestionRequest request) {
        List<String> tags = request.tags() == null ? List.of() : request.tags();
        return questions.update(id, request.text(), request.options(), tags)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found"));
    }

    @Transactional
    public void archive(UUID id) {
        if (!questions.archive(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found");
        }
    }
}
