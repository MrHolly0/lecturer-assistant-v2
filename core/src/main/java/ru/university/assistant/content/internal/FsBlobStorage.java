package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Collection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import ru.university.assistant.shared.api.UuidV7;

@Component
class FsBlobStorage implements BlobStorage {
    private final ContentProperties properties;
    private final JdbcClient jdbc;
    private final BlobBudget budget;
    private final TransactionTemplate transactions;

    FsBlobStorage(
            ContentProperties properties,
            JdbcClient jdbc,
            TransactionTemplate transactions,
            BlobBudget budget) {
        this.budget = budget;
        this.properties = properties;
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    @Override
    public StoredBlob store(
            InputStream inputStream, String filename, String contentType, long sizeBytes)
            throws IOException {
        return withBackupLock(
                () -> storeLocked(inputStream, filename, contentType, sizeBytes, null));
    }

    @Override
    public StoredBlob storeForCourse(
            java.util.UUID course, InputStream input, String filename, String type, long bytes)
            throws IOException {
        return withBackupLock(() -> storeLocked(input, filename, type, bytes, course));
    }

    private StoredBlob storeLocked(
            InputStream inputStream,
            String filename,
            String contentType,
            long sizeBytes,
            java.util.UUID course)
            throws IOException {
        String cleanName = StringUtils.cleanPath(filename == null ? "upload.bin" : filename);
        String ref = UuidV7.generate() + "/" + cleanName.replaceAll("[^A-Za-z0-9._-]", "_");
        Path target = root().resolve(ref).normalize();
        ensureInsideRoot(target);
        Files.createDirectories(root());
        budget.reserve(root(), ref, course, sizeBytes);
        Files.createDirectories(target.getParent());
        try (var output = Files.newOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            long written = 0;
            int count;
            while ((count = inputStream.read(buffer)) != -1) {
                written += count;
                if (written > sizeBytes) throw new IOException("Upload exceeds reserved bytes");
                output.write(buffer, 0, count);
            }
            if (written != sizeBytes) throw new IOException("Upload size differs from reservation");
        } catch (IOException failure) {
            Files.deleteIfExists(target);
            throw failure;
        }
        String safeContentType = contentType == null ? "application/octet-stream" : contentType;
        return new StoredBlob(ref, cleanName, safeContentType, sizeBytes);
    }

    @Override
    public StoredBlob storeBytes(byte[] bytes, String filename, String contentType)
            throws IOException {
        return store(new java.io.ByteArrayInputStream(bytes), filename, contentType, bytes.length);
    }

    @Override
    public BlobResource resource(String ref, String contentType) {
        Path path = root().resolve(ref).normalize();
        ensureInsideRoot(path);
        return new BlobResource(
                path, contentType == null ? "application/octet-stream" : contentType);
    }

    @Override
    public void delete(String ref) throws IOException {
        withBackupLock(
                () -> {
                    deleteLocked(ref);
                    return null;
                });
    }

    @Override
    public void deleteAll(Collection<String> refs) throws IOException {
        withBackupLock(
                () -> {
                    for (String ref : refs) deleteLocked(ref);
                    return null;
                });
    }

    private void deleteLocked(String ref) throws IOException {
        Path path = root().resolve(ref).normalize();
        ensureInsideRoot(path);
        budget.release(ref);
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
    public void publish(Path input, String ref, String originalRef) throws IOException {
        withBackupLock(
                () -> {
                    Path target = root().resolve(ref).normalize();
                    ensureInsideRoot(target);
                    budget.reserve(root(), ref, budget.owner(originalRef), Files.size(input));
                    Files.createDirectories(target.getParent());
                    Path temporary = Files.createTempFile(target.getParent(), ".publish-", ".tmp");
                    try {
                        Files.copy(input, temporary, StandardCopyOption.REPLACE_EXISTING);
                        Files.move(
                                temporary,
                                target,
                                StandardCopyOption.ATOMIC_MOVE,
                                StandardCopyOption.REPLACE_EXISTING);
                    } finally {
                        Files.deleteIfExists(temporary);
                    }
                    return null;
                });
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
            return transactions.execute(
                    status -> {
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
