package ru.university.assistant.channel.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.channel.internal.ChannelMediaStore;

@RestController
public class ChannelMediaController {
    private final ChannelMediaStore media;
    private final byte[] apiKey;

    ChannelMediaController(ChannelMediaStore media, @Value("${app.channel.internal-api-key}") String apiKey) {
        this.media = media;
        this.apiKey = apiKey.getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping(value = "/internal/v1/channels/max/media/{token}", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<byte[]> file(@PathVariable String token,
            @RequestHeader(value = "X-Internal-Api-Key", required = false) String key) {
        if (key == null || !MessageDigest.isEqual(apiKey, key.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid internal API key");
        }
        ChannelMediaStore.MediaFile file = media.file(token);
        String disposition = ContentDisposition.attachment().filename(file.filename()).build().toString();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_JPEG)
                .header("Content-Disposition", disposition)
                .header("X-Content-Type-Options", "nosniff").body(file.bytes());
    }
}
