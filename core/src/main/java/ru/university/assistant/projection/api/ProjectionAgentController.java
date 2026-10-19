package ru.university.assistant.projection.api;

import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.projection.api.ProjectionContracts.PairRequest;
import ru.university.assistant.projection.api.ProjectionContracts.PairedDevice;
import ru.university.assistant.projection.api.ProjectionContracts.PollRequest;
import ru.university.assistant.projection.api.ProjectionContracts.PollResponse;
import ru.university.assistant.projection.internal.ProjectionService;

/** Device authentication is performed explicitly here; staff JWTs never become device credentials. */
@RestController
@RequestMapping("/api/v1/projection/agent")
public class ProjectionAgentController {
    private final ProjectionService projection;

    public ProjectionAgentController(ProjectionService projection) {
        this.projection = projection;
    }

    @PostMapping("/pair")
    @ResponseStatus(HttpStatus.CREATED)
    public ResponseEntity<PairedDevice> pair(@Valid @RequestBody PairRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(projection.pair(request));
    }

    @PostMapping("/poll")
    public ResponseEntity<PollResponse> poll(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody PollRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(projection.poll(authorization, request));
    }
}
