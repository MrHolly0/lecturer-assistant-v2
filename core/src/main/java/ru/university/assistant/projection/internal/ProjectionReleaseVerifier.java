package ru.university.assistant.projection.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import ru.university.assistant.projection.api.ProjectionContracts;
import ru.university.assistant.projection.api.ProjectionContracts.Platform;
import ru.university.assistant.projection.api.ProjectionContracts.SignedReleaseEnvelope;

/** Verifies the same exact-payload P-256/P1363 envelope consumed by the native updater. */
public final class ProjectionReleaseVerifier {
    private ProjectionReleaseVerifier() {}

    public record Trust(String repository, Map<String, String> keys) {}
    public record VerifiedRelease(Platform platform, String artifactType, String version, String minimumOsVersion,
            long sequence, Instant expiresAt, String url, long size, String sha256,
            SignedReleaseEnvelope envelope, String payloadHash) {}

    public static VerifiedRelease verify(SignedReleaseEnvelope envelope, Trust trust,
            ObjectMapper json, Instant now) {
        try {
            if (trust.repository() == null || !trust.repository().matches(
                    "[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}")) {
                throw invalid("INVALID_RELEASE_REPOSITORY");
            }
            if (envelope.keyId() == null || !envelope.keyId().matches("[A-Za-z0-9_-]{1,64}")
                    || envelope.payload() == null || envelope.payload().length() > 32768
                    || envelope.signature() == null || envelope.signature().length() != 88) {
                throw invalid("INVALID_RELEASE_ENVELOPE");
            }
            String encodedKey = trust.keys().get(envelope.keyId());
            if (encodedKey == null || encodedKey.length() > 8192) throw invalid("UNTRUSTED_RELEASE_KEY");
            var key = KeyFactory.getInstance("EC").generatePublic(
                    new X509EncodedKeySpec(Base64.getDecoder().decode(encodedKey)));
            AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
            parameters.init(new ECGenParameterSpec("secp256r1"));
            ECParameterSpec p256 = parameters.getParameterSpec(ECParameterSpec.class);
            if (!(key instanceof ECPublicKey ec) || !ec.getParams().getCurve().equals(p256.getCurve())
                    || !ec.getParams().getGenerator().equals(p256.getGenerator())
                    || !ec.getParams().getOrder().equals(p256.getOrder())
                    || ec.getParams().getCofactor() != p256.getCofactor()) throw invalid("WRONG_RELEASE_KEY_CURVE");
            byte[] payload = Base64.getDecoder().decode(envelope.payload());
            byte[] signature = Base64.getDecoder().decode(envelope.signature());
            Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
            verifier.initVerify(key); verifier.update(payload);
            if (signature.length != 64 || !verifier.verify(signature)) throw invalid("INVALID_RELEASE_SIGNATURE");
            JsonNode manifest = json.reader()
                    .with(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .readTree(payload);
            String version = text(manifest, "version"), minimumOs = text(manifest, "minimumOsVersion");
            if (!version.matches(ProjectionContracts.VERSION_PATTERN) || numericVersion(minimumOs) == null) {
                throw invalid("INVALID_RELEASE_VERSION");
            }
            Platform platform = Platform.valueOf(text(manifest, "platform"));
            String artifactType = manifest.has("artifactType") ? text(manifest, "artifactType") : "UPDATE";
            if (!artifactType.equals("UPDATE") && !artifactType.equals("INSTALLER")) {
                throw invalid("INVALID_ARTIFACT_TYPE");
            }
            if (!manifest.path("protocolVersion").isInt() || manifest.path("protocolVersion").intValue() != 1) {
                throw invalid("UNSUPPORTED_RELEASE_PROTOCOL");
            }
            long sequence = positiveLong(manifest, "sequence"), size = positiveLong(manifest, "size");
            if (size > 536870912) throw invalid("RELEASE_TOO_LARGE");
            Instant published = Instant.parse(text(manifest, "publishedAt"));
            Instant expires = Instant.parse(text(manifest, "expiresAt"));
            if (published.isAfter(now.plusSeconds(300)) || !expires.isAfter(now) || !expires.isAfter(published)
                    || Duration.between(published, expires).compareTo(Duration.ofDays(14)) > 0) {
                throw invalid("EXPIRED_RELEASE_METADATA");
            }
            String url = text(manifest, "url");
            URI asset = URI.create(url);
            String prefix = "/" + trust.repository() + "/releases/download/";
            if (!"https".equals(asset.getScheme()) || !"github.com".equals(asset.getHost())
                    || (asset.getPort() != -1 && asset.getPort() != 443) || asset.getRawUserInfo() != null
                    || asset.getRawQuery() != null || asset.getRawFragment() != null || !asset.equals(asset.normalize())
                    || !asset.getRawPath().startsWith(prefix) || asset.getRawPath().substring(prefix.length()).isEmpty()
                    || asset.getRawPath().contains("%") || url.length() > 4096) {
                throw invalid("UNTRUSTED_RELEASE_ASSET");
            }
            String sha256 = text(manifest, "sha256"), entry = text(manifest, "entryPoint");
            if (!sha256.matches("[a-fA-F0-9]{64}") || entry.length() > 240 || entry.startsWith("/")
                    || entry.contains("..") || entry.contains("\\") || entry.contains(":")) {
                throw invalid("INVALID_RELEASE_PACKAGE");
            }
            return new VerifiedRelease(platform, artifactType, version, minimumOs, sequence, expires, url, size,
                    sha256.toLowerCase(java.util.Locale.ROOT), envelope,
                    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(payload)));
        } catch (CatalogException exception) {
            throw exception;
        } catch (Exception exception) {
            // Parsing/provider errors must never print signed payloads, filesystem paths or key material.
            throw invalid("INVALID_RELEASE_METADATA");
        }
    }

    public static boolean supportsOs(String actual, String minimum) {
        int[] current = numericVersion(actual), required = numericVersion(minimum);
        if (current == null || required == null) return false;
        for (int i = 0; i < current.length; i++) {
            if (current[i] != required[i]) return current[i] > required[i];
        }
        return true;
    }

    private static int[] numericVersion(String value) {
        if (value == null || !value.matches("[0-9]{1,5}(\\.[0-9]{1,5}){1,3}")) return null;
        int[] result = new int[4];
        String[] pieces = value.split("\\.");
        for (int i = 0; i < pieces.length; i++) result[i] = Integer.parseInt(pieces[i]);
        return result;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isTextual() || value.textValue().isBlank()) throw invalid("INVALID_RELEASE_FIELD");
        return value.textValue();
    }

    private static long positiveLong(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 1) {
            throw invalid("INVALID_RELEASE_FIELD");
        }
        return value.longValue();
    }

    static CatalogException invalid(String code) { return new CatalogException(code); }

    public static final class CatalogException extends RuntimeException {
        CatalogException(String code) { super(code); }
    }
}
