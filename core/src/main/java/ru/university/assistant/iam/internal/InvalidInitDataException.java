package ru.university.assistant.iam.internal;

/** initData не прошёл проверку. Сообщение не содержит самих данных, чтобы они не попали в логи. */
class InvalidInitDataException extends RuntimeException {
    InvalidInitDataException(String reason) {
        super(reason);
    }
}
