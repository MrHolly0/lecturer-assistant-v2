package ru.university.assistant.projection.internal;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ru.university.assistant.projection.api.ProjectionContracts.Installer;
import ru.university.assistant.projection.api.ProjectionContracts.Platform;
import ru.university.assistant.projection.api.ProjectionContracts.SignedReleaseEnvelope;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier.Trust;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier.VerifiedRelease;

/** Operator-provisioned local catalog; untrusted metadata never supplies its own signing keys. */
@Service
public class ProjectionReleaseCatalog {
    private static final Logger LOG = LoggerFactory.getLogger(ProjectionReleaseCatalog.class);
    private final Path catalogPath;
    private final Path trustPath;
    private final ObjectMapper json;
    private final Clock clock;
    private final ProjectionCatalogStore store;
    private List<VerifiedRelease> cached = List.of();
    private String diagnostic;

    public ProjectionReleaseCatalog(@Value("${app.projection.releases.catalog-path:}") String catalogPath,
            @Value("${app.projection.releases.trust-path:}") String trustPath,
            ObjectMapper json, Clock clock, ProjectionCatalogStore store) {
        this.catalogPath = catalogPath.isBlank() ? null : Path.of(catalogPath);
        this.trustPath = trustPath.isBlank() ? null : Path.of(trustPath);
        this.json = json; this.clock = clock; this.store = store;
    }

    public List<Installer> installers(String minimumVersion) {
        return current().stream().filter(value -> value.artifactType().equals("INSTALLER")
                        && !ProjectionVersion.older(value.version(), minimumVersion))
                .map(value -> new Installer(value.platform(), value.version(), value.minimumOsVersion(),
                        value.url(), value.sha256(), value.size())).toList();
    }

    public String latestVersion(String minimumVersion) {
        return current().stream().filter(value -> value.artifactType().equals("UPDATE")
                        && !ProjectionVersion.older(value.version(), minimumVersion)).map(VerifiedRelease::version)
                .max((left, right) -> ProjectionVersion.older(left, right)
                        ? -1 : ProjectionVersion.older(right, left) ? 1 : 0)
                .orElse(null);
    }

    public SignedReleaseEnvelope update(Platform platform, String osVersion, String runningVersion,
            String minimumVersion) {
        return current().stream().filter(value -> value.artifactType().equals("UPDATE") && value.platform() == platform
                        && ProjectionReleaseVerifier.supportsOs(osVersion, value.minimumOsVersion())
                        && ProjectionVersion.older(runningVersion, value.version())
                        && !ProjectionVersion.older(value.version(), minimumVersion))
                .map(VerifiedRelease::envelope).findFirst().orElse(null);
    }

    private synchronized List<VerifiedRelease> current() {
        return cached.stream().filter(value -> value.expiresAt().isAfter(clock.instant())).toList();
    }

    @Scheduled(fixedDelay = 5000)
    public synchronized void refresh() {
        Instant now = clock.instant();
        if (catalogPath == null || trustPath == null) return;
        try {
            Trust trust = json.readerFor(Trust.class).with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .readValue(readBounded(trustPath, 65536));
            if (trust.keys() == null || trust.keys().isEmpty() || trust.keys().size() > 16) {
                throw ProjectionReleaseVerifier.invalid("RELEASE_TRUST_NOT_PROVISIONED");
            }
            JsonNode root = json.reader().with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .readTree(readBounded(catalogPath, 262144));
            JsonNode entries = root.path("releases");
            if (!root.path("schemaVersion").isInt() || root.path("schemaVersion").intValue() != 1
                    || !entries.isArray() || entries.size() > 16) {
                throw ProjectionReleaseVerifier.invalid("INVALID_RELEASE_CATALOG");
            }
            List<VerifiedRelease> verified = new ArrayList<>();
            HashSet<String> platforms = new HashSet<>();
            for (JsonNode entry : entries) {
                SignedReleaseEnvelope envelope = json.treeToValue(entry, SignedReleaseEnvelope.class);
                VerifiedRelease release = ProjectionReleaseVerifier.verify(envelope, trust, json, now);
                if (!platforms.add(release.platform().name() + ":" + release.artifactType())) {
                    throw ProjectionReleaseVerifier.invalid("DUPLICATE_PLATFORM");
                }
                verified.add(release);
            }
            store.accept(verified);
            cached = List.copyOf(verified); diagnostic = null;
        } catch (Exception exception) {
            cached = List.of();
            String code = exception instanceof ProjectionReleaseVerifier.CatalogException
                    ? exception.getMessage() : "RELEASE_CATALOG_UNAVAILABLE";
            if (!code.equals(diagnostic)) LOG.warn("Projector release catalog unavailable: {}", code);
            diagnostic = code;
        }
    }

    private byte[] readBounded(Path path, int maximum) throws java.io.IOException {
        try (var input = Files.newInputStream(path)) {
            byte[] bytes = input.readNBytes(maximum + 1);
            if (bytes.length > maximum) throw ProjectionReleaseVerifier.invalid("RELEASE_CATALOG_TOO_LARGE");
            return bytes;
        }
    }
}
