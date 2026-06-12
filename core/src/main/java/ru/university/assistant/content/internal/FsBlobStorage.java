package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import ru.university.assistant.shared.api.UuidV7;

@Component
class FsBlobStorage implements BlobStorage {
    private final ContentProperties properties;

    FsBlobStorage(ContentProperties properties) {
        this.properties = properties;
    }

    @Override
    public StoredBlob store(InputStream inputStream, String filename, String contentType, long sizeBytes)
            throws IOException {
        String cleanName = StringUtils.cleanPath(filename == null ? "upload.bin" : filename);
        String ref = UuidV7.generate() + "/" + cleanName.replaceAll("[^A-Za-z0-9._-]", "_");
        Path target = root().resolve(ref).normalize();
        ensureInsideRoot(target);
        Files.createDirectories(target.getParent());
        Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
        String safeContentType = contentType == null ? "application/octet-stream" : contentType;
        return new StoredBlob(ref, cleanName, safeContentType, sizeBytes);
    }

    @Override
    public StoredBlob storeBytes(byte[] bytes, String filename, String contentType) throws IOException {
        return store(new java.io.ByteArrayInputStream(bytes), filename, contentType, bytes.length);
    }

    @Override
    public BlobResource resource(String ref, String contentType) {
        Path path = root().resolve(ref).normalize();
        ensureInsideRoot(path);
        return new BlobResource(path, contentType == null ? "application/octet-stream" : contentType);
    }

    @Override
    public void delete(String ref) throws IOException {
        Path path = root().resolve(ref).normalize();
        ensureInsideRoot(path);
        Files.deleteIfExists(path);
        Path parent = path.getParent();
        if (parent != null && !parent.equals(root()) && parent.startsWith(root())) {
            try {
                Files.deleteIfExists(parent);
            } catch (java.nio.file.DirectoryNotEmptyException ignored) {
                // Several blobs may share a generated directory during a single import.
            }
        }
    }

    @Override
    public Path root() {
        return properties.blobRoot().toAbsolutePath().normalize();
    }

    private void ensureInsideRoot(Path path) {
        if (!path.startsWith(root())) {
            throw new IllegalArgumentException("Blob path escapes storage root");
        }
    }
}
