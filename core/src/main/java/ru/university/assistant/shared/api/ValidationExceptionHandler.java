package ru.university.assistant.shared.api;

import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * B-13: без этого обработчика Spring логирует необработанный {@link MethodArgumentNotValidException}
 * через {@code DefaultHandlerExceptionResolver} на уровне WARN вместе с {@code toString()} каждого
 * {@link FieldError} — а он включает присланное значение поля целиком. Для initData/паролей это
 * значит, что секрет длиной до нескольких килобайт может попасть в лог сервера при обычной ошибке
 * валидации. Здесь логируются только имена полей, значения — никогда.
 */
@RestControllerAdvice
class ValidationExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(ValidationExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException exception) {
        List<String> fields =
                exception.getBindingResult().getFieldErrors().stream().map(FieldError::getField).toList();
        LOG.debug("Validation failed for fields: {}", fields);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", "validation_failed", "fields", fields));
    }
}
