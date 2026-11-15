package ru.university.assistant.installation.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.HashSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class ReleaseCatalog {
    private final String publicKey;
    private final ObjectMapper json;

    ReleaseCatalog(@Value("${app.installation.release-public-key:}") String publicKey, ObjectMapper json) {
        this.publicKey = publicKey;
        this.json = json.copy().enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    }

    public JsonNode verify(String payload, String encodedSignature) {
        try {
            if (payload == null || payload.length() > 262144 || encodedSignature == null
                    || encodedSignature.length() > 256 || publicKey.isBlank()) throw new IllegalArgumentException();
            byte[] key = Base64.getDecoder().decode(publicKey.replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", ""));
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(key)));
            verifier.update(payload.getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(Base64.getDecoder().decode(encodedSignature))) throw new IllegalArgumentException();
            JsonNode catalog = json.readTree(payload);
            if (!catalog.path("schema").isIntegralNumber() || catalog.path("schema").asInt() != 1
                    || !Instant.parse(catalog.path("expiresAt").asText()).isAfter(Instant.now())
                    || !catalog.path("releases").isArray() || catalog.path("releases").size() > 30) {
                throw new IllegalArgumentException();
            }
            var ids = new HashSet<String>();
            for (var release : catalog.path("releases")) {
                String id = release.path("id").asText();
                if (!id.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}") || !ids.add(id)
                        || release.path("version").asText().isBlank() || release.path("version").asText().length() > 80
                        || release.path("notes").asText().length() > 6000
                        || !release.path("commit").asText().matches("[a-f0-9]{40}")
                        || !release.path("backwardCompatible").isBoolean()
                        || !release.path("backwardCompatible").asBoolean()
                        || !release.path("images").isObject() || release.path("images").size() > 12
                        || !release.path("images").has("core") || !release.path("images").has("web")) {
                    throw new IllegalArgumentException();
                }
                long minimum = release.path("databaseMin").asLong(-1);
                long maximum = release.path("databaseMax").asLong(-1);
                if (!release.path("databaseMin").canConvertToLong() || !release.path("databaseMax").canConvertToLong()
                        || !release.path("databaseMin").isIntegralNumber()
                        || !release.path("databaseMax").isIntegralNumber()
                        || minimum < 0 || maximum < minimum) throw new IllegalArgumentException();
                var images = release.path("images").fields();
                while (images.hasNext()) {
                    var image = images.next();
                    if (!image.getKey().matches("core|web|services|sfu|max-adapter|converter|authority")
                            || !image.getValue().asText().matches("[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64}")) {
                        throw new IllegalArgumentException();
                    }
                }
            }
            return catalog;
        } catch (Exception invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Каталог релизов не прошёл проверку подписи, срока действия или совместимости");
        }
    }

    public JsonNode release(String payload, String signature, String id) {
        for (var release : verify(payload, signature).path("releases")) {
            if (release.path("id").asText().equals(id)) return release;
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Релиз не найден в проверенном каталоге");
    }
}
