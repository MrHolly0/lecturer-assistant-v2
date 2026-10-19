package ru.university.assistant.projection.internal;

import org.springframework.stereotype.Component;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.ScopedRequestAuthenticationApi;

@Component
class LectureControlAuthentication implements ScopedRequestAuthenticationApi {
    private final ProjectionService projection;

    LectureControlAuthentication(ProjectionService projection) {
        this.projection = projection;
    }

    @Override
    public String headerName() {
        return "X-Lecture-Control-Token";
    }

    @Override
    public AuthenticatedUser authenticate(String method, String requestPath, String credential) {
        return projection.requireLectureControl(method, requestPath, credential);
    }
}
