package ru.university.assistant.projection.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.university.assistant.projection.api.ProjectionContracts.Platform;
import ru.university.assistant.projection.api.ProjectionContracts.SignedReleaseEnvelope;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier.Trust;

class ProjectionReleaseCatalogTest {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private final MutableClock clock = new MutableClock();
    private final ProjectionCatalogStore store = mock(ProjectionCatalogStore.class);
    private KeyPair keys;
    private Trust trust;

    @BeforeEach
    void setup() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        keys = generator.generateKeyPair();
        trust = new Trust("institution/projector-agent",
                Map.of("release-v1", Base64.getEncoder().encodeToString(keys.getPublic().getEncoded())));
    }

    @Test
    void defaultsStayEmptyAndDoNotAccessUnconfiguredTrustOrDatabase() {
        var catalog = new ProjectionReleaseCatalog("", "", json, clock, store);
        catalog.refresh();
        assertTrue(catalog.installers("0.1.0").isEmpty());
        assertNull(catalog.latestVersion("0.1.0"));
        assertNull(catalog.update(Platform.WINDOWS_X64, "10.0.22621", "0.1.0", "0.1.0"));
        verifyNoInteractions(store);
    }

    @Test
    void verifiedUpdatesAndExplicitInstallersAreSeparatedAndCompatibleOsVersionIsRequired() throws Exception {
        var update = signed(manifest("UPDATE"));
        var installer = signed(manifest("INSTALLER"));
        var catalog = catalog(List.of(update, installer));
        catalog.refresh();
        assertEquals(1, catalog.installers("0.1.0").size());
        assertEquals("10.0.19045", catalog.installers("0.1.0").getFirst().minimumOsVersion());
        assertEquals("2.0.0", catalog.latestVersion("0.1.0"));
        assertEquals(update, catalog.update(Platform.WINDOWS_X64, "10.0.22621.0", "0.1.0", "1.0.0"));
        assertNull(catalog.update(Platform.WINDOWS_X64, "10.0.10000", "0.1.0", "0.1.0"));
        assertNull(catalog.update(Platform.WINDOWS_X64, "Windows 11", "0.1.0", "0.1.0"));
        assertNull(catalog.update(Platform.MACOS_ARM64, "26.0.0", "0.1.0", "0.1.0"));
        assertNull(catalog.update(Platform.WINDOWS_X64, "10.0.22621", "2.0.0", "0.1.0"));
        assertNull(catalog.update(Platform.WINDOWS_X64, "10.0.22621", "0.1.0", "3.0.0"));
        assertTrue(catalog.installers("3.0.0").isEmpty());
        clock.advance(3600);
        assertTrue(catalog.installers("0.1.0").isEmpty());
        assertNull(catalog.latestVersion("0.1.0"));
    }

    @Test
    void signatureFailureAndWithdrawnTrustDiscardPreviouslyCachedOffers() throws Exception {
        var valid = signed(manifest("UPDATE"));
        var catalog = catalog(List.of(valid));
        catalog.refresh();
        assertNotNull(catalog.update(Platform.WINDOWS_X64, "10.0.22621", "0.1.0", "0.1.0"));
        byte[] signature = Base64.getDecoder().decode(valid.signature()); signature[0] ^= 1;
        writeCatalog(List.of(new SignedReleaseEnvelope(valid.keyId(), valid.payload(),
                Base64.getEncoder().encodeToString(signature))));
        catalog.refresh();
        assertNull(catalog.latestVersion("0.1.0"));
        writeCatalog(List.of(valid));
        Files.writeString(directory.resolve("trust.json"),
                "{\"repository\":\"institution/projector-agent\",\"keys\":{}}");
        catalog.refresh();
        assertNull(catalog.latestVersion("0.1.0"));
    }

    @Test
    void validSignatureDoesNotAuthorizeExpiredMetadataWrongRepoProtocolEntryPointOrOversizePackage() throws Exception {
        Map<String, Object> changes = Map.of(
                "expiresAt", clock.instant().minusSeconds(1).toString(),
                "url", "https://github.com/attacker/other/releases/download/v2/package.zip",
                "protocolVersion", 2,
                "entryPoint", "../evil.exe",
                "size", 536870913L,
                "artifactType", "SCRIPT");
        for (var change : changes.entrySet()) {
            Map<String, Object> payload = manifest("UPDATE"); payload.put(change.getKey(), change.getValue());
            assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                    () -> ProjectionReleaseVerifier.verify(signed(payload), trust, json, clock.instant()),
                    change.getKey());
        }
        for (String url : List.of("https://evil.example/package.zip",
                "https://github.com/institution/projector-agent/releases/download/v2/../package.zip",
                "https://github.com:8443/institution/projector-agent/releases/download/v2/package.zip",
                "https://github.com/institution/projector-agent/releases/download/v2/package.zip?script=1")) {
            Map<String, Object> payload = manifest("UPDATE"); payload.put("url", url);
            assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                    () -> ProjectionReleaseVerifier.verify(signed(payload), trust, json, clock.instant()));
        }
    }

    @Test
    void catalogCannotSmuggleItsOwnTrustAndResourceLimitsAndReplayFailClosed() throws Exception {
        var valid = signed(manifest("UPDATE"));
        var catalog = catalog(List.of(valid));
        doThrow(ProjectionReleaseVerifier.invalid("REPLAYED_RELEASE_METADATA")).when(store).accept(anyList());
        catalog.refresh();
        assertNull(catalog.latestVersion("0.1.0"));
        Files.write(directory.resolve("catalog.json"), new byte[262145]);
        catalog.refresh();
        assertNull(catalog.latestVersion("0.1.0"));
        Files.writeString(directory.resolve("catalog.json"),
                "{\"schemaVersion\":1,\"schemaVersion\":1,\"releases\":[]}");
        catalog.refresh();
        assertNull(catalog.latestVersion("0.1.0"));
        var foreign = new SignedReleaseEnvelope("catalog-supplied-key", valid.payload(), valid.signature());
        assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                () -> ProjectionReleaseVerifier.verify(foreign, trust, json, clock.instant()));
    }

    private ProjectionReleaseCatalog catalog(List<SignedReleaseEnvelope> entries) throws Exception {
        Files.write(directory.resolve("trust.json"), json.writeValueAsBytes(trust));
        writeCatalog(entries);
        return new ProjectionReleaseCatalog(directory.resolve("catalog.json").toString(),
                directory.resolve("trust.json").toString(), json, clock, store);
    }
    private void writeCatalog(List<SignedReleaseEnvelope> entries) throws Exception {
        Files.write(directory.resolve("catalog.json"), json.writeValueAsBytes(Map.of("schemaVersion", 1,
                "releases", entries)));
    }
    private SignedReleaseEnvelope signed(Map<String, Object> manifest) throws Exception {
        byte[] bytes = json.writeValueAsBytes(manifest);
        Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
        signer.initSign(keys.getPrivate()); signer.update(bytes);
        return new SignedReleaseEnvelope("release-v1", Base64.getEncoder().encodeToString(bytes),
                Base64.getEncoder().encodeToString(signer.sign()));
    }
    private Map<String, Object> manifest(String kind) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sequence", 2); result.put("version", "2.0.0"); result.put("platform", "WINDOWS_X64");
        result.put("artifactType", kind); result.put("minimumOsVersion", "10.0.19045");
        result.put("protocolVersion", 1); result.put("publishedAt", clock.instant().minusSeconds(60).toString());
        result.put("expiresAt", clock.instant().plusSeconds(3600).toString());
        result.put("url", "https://github.com/institution/projector-agent/releases/download/v2/package.zip");
        result.put("size", 100); result.put("sha256", "1".repeat(64));
        result.put("entryPoint", "app/Projector.Windows.exe");
        return result;
    }
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-19T10:00:00Z");
        void advance(long seconds) { now = now.plusSeconds(seconds); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
