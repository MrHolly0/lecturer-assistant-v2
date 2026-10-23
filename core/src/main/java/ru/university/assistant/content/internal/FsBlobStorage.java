package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Collection;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import ru.university.assistant.shared.api.UuidV7;

@Component
class FsBlobStorage implements BlobStorage {
    private final ContentProperties properties;
    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;

    FsBlobStorage(ContentProperties properties, JdbcClient jdbc, TransactionTemplate transactions) {
        this.properties = properties;
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    @Override
    public StoredBlob store(InputStream inputStream, String filename, String contentType, long sizeBytes)
            throws IOException {
        return withBackupLock(() -> storeLocked(inputStream, filename, contentType, sizeBytes));
    }

    private StoredBlob storeLocked(InputStream inputStream, String filename, String contentType, long sizeBytes)
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
        withBackupLock(() -> {
            deleteLocked(ref);
            return null;
        });
    }

    @Override
    public void deleteAll(Collection<String> refs) throws IOException {
        withBackupLock(() -> {
            for (String ref : refs) deleteLocked(ref);
            return null;
        });
    }

    private void deleteLocked(String ref) throws IOException {
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

    private <T> T withBackupLock(IoSupplier<T> operation) throws IOException {
        try {
            return transactions.execute(status -> {
                // Writers use distinct UUID paths; only a backup needs exclusive ownership.
                jdbc.sql("select pg_advisory_xact_lock_shared(14713, 2525)")
                        .query((rs, row) -> rs.getString(1))
                        .single();
                try {
                    return operation.get();
                } catch (IOException exception) {
                    throw new UncheckedIOException(exception);
                }
            });
        } catch (UncheckedIOException exception) {
            throw exception.getCause();
        }
    }

    @FunctionalInterface
    private interface IoSupplier<T> {
        T get() throws IOException;
    }
}
