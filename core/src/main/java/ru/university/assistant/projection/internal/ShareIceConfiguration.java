package ru.university.assistant.projection.internal;

import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import ru.university.assistant.projection.api.ShareContracts.IceServer;

/** Opt-in institution ICE service; never silently sends network metadata to a public vendor. */
@Component
public class ShareIceConfiguration {
    private final List<IceServer> servers;
    public ShareIceConfiguration(@Value("${app.projection.ice-urls:}") String urls,
            @Value("${app.projection.ice-username:}") String username,
            @Value("${app.projection.ice-credential:}") String credential) {
        List<String> parsed = Arrays.stream(urls.split(",")).map(String::trim)
                .filter(value -> !value.isEmpty()).toList();
        if (parsed.stream().anyMatch(value -> !value.matches("(?i)^(stun|stuns|turn|turns):[^\\s]+$"))) {
            throw new IllegalArgumentException("Invalid projection ICE URL");
        }
        servers = parsed.isEmpty() ? List.of() : List.of(new IceServer(parsed, username, credential));
    }
    public List<IceServer> servers() { return servers; }
}
