package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.Collection;

public interface BlobStorage {
    StoredBlob store(InputStream inputStream, String filename, String contentType, long sizeBytes) throws IOException;

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
