package ru.university.assistant.live.api;

import java.util.UUID;

/**
 * SPI для других модулей (D-10): проверить, что сессия действительно принадлежит курсу,
 * прежде чем действовать над чем-то вложенным в неё (опрос, прогон активности).
 */
public interface LiveSessionAccessApi {
    /** 404, если сессии с таким id нет. */
    LiveSession requireSession(UUID sessionId);

    /** 404, если сессии с таким id в этом курсе нет. */
    LiveSession requireSessionInCourse(UUID courseId, UUID sessionId);

    /** Публикует безопасный session envelope для преподавательских клиентов. */
    void publishSessionUpdate(UUID sessionId, String type);
}
