package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.Collection;

public interface BlobStorage {
    StoredBlob store(InputStream inputStream, String filename, String contentType, long sizeBytes)
            throws IOException;

    default StoredBlob storeForCourse(
            java.util.UUID course, InputStream input, String filename, String type, long bytes)
            throws IOException {
        return store(input, filename, type, bytes);
    }

    default void publish(Path source, String ref, String originalRef) throws IOException {
        java.nio.file.Files.createDirectories(root().resolve(ref).getParent());
        java.nio.file.Files.copy(
                source, root().resolve(ref), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    StoredBlob storeBytes(byte[] bytes, String filename, String contentType) throws IOException;

    BlobResource resource(String ref, String contentType);

    void delete(String ref) throws IOException;

    default void deleteAll(Collection<String> refs) throws IOException {
        for (String ref : refs) {
            delete(ref);
        }
    }

    Path root();
}
