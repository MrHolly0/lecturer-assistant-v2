package ru.university.assistant.projection.internal;

import java.util.Comparator;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier.VerifiedRelease;

/** Persisted high-water marks keep an older signed catalog from becoming current after a restart. */
@Service
public class ProjectionCatalogStore {
    private final JdbcClient jdbc;

    public ProjectionCatalogStore(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void accept(List<VerifiedRelease> releases) {
        for (VerifiedRelease release : releases.stream()
                .sorted(Comparator.comparing(value -> value.platform().name() + ":" + value.artifactType())).toList()) {
            String platform = release.platform().name();
            jdbc.sql("""
                    insert into projection.release_checkpoints(platform, artifact_type, sequence, version, payload_hash)
                    values (?, ?, 0, '0.0.0', '') on conflict(platform, artifact_type) do nothing
                    """).params(platform, release.artifactType()).update();
            var previous = jdbc.sql("""
                    select * from projection.release_checkpoints where platform = ? and artifact_type = ? for update
                    """).params(platform, release.artifactType()).query((row, index) -> new Checkpoint(
                            row.getLong("sequence"), row.getString("version"), row.getString("payload_hash"))).single();
            if (release.sequence() < previous.sequence()
                    || ProjectionVersion.older(release.version(), previous.version())
                    || (release.sequence() == previous.sequence()
                    && !release.payloadHash().equals(previous.payloadHash()))) {
                throw ProjectionReleaseVerifier.invalid("REPLAYED_RELEASE_METADATA");
            }
            if (release.sequence() > previous.sequence()) {
                jdbc.sql("""
                        update projection.release_checkpoints set sequence = ?, version = ?, payload_hash = ?,
                            updated_at = now() where platform = ? and artifact_type = ?
                        """).params(release.sequence(), release.version(), release.payloadHash(),
                                platform, release.artifactType()).update();
            }
        }
    }

    private record Checkpoint(long sequence, String version, String payloadHash) {}
}
