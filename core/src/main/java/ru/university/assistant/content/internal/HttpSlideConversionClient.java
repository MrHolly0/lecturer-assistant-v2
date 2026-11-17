package ru.university.assistant.content.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

class HttpSlideConversionClient implements SlideConversionClient {
    static final int MAX_EVENT_BYTES = 2 * 1024 * 1024;
    static final int MAX_ERROR_BYTES = 16 * 1024;
    private static final java.util.concurrent.ScheduledThreadPoolExecutor DEADLINES = deadlines();

    private static java.util.concurrent.ScheduledThreadPoolExecutor deadlines() {
        var executor =
                new java.util.concurrent.ScheduledThreadPoolExecutor(
                        1,
                        task -> {
                            Thread thread = new Thread(task, "conversion-deadlines");
                            thread.setDaemon(true);
                            return thread;
                        });
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

    private final BlobStorage blobStorage;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final DataSource dataSource;
    private final java.nio.file.Path conversionRoot;
    private final String converterKey;

    HttpSlideConversionClient(
            BlobStorage blobStorage,
            ContentProperties properties,
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            DataSource dataSource) {
        this(
                blobStorage,
                properties,
                builder,
                objectMapper,
                dataSource,
                java.nio.file.Path.of(System.getProperty("java.io.tmpdir"), "lecture-conversion"),
                "");
    }

    HttpSlideConversionClient(
            BlobStorage blobStorage,
            ContentProperties properties,
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            DataSource dataSource,
            java.nio.file.Path conversionRoot,
            String converterKey) {
        this.conversionRoot = conversionRoot.toAbsolutePath().normalize();
        this.converterKey = converterKey;
        this.blobStorage = blobStorage;
        this.objectMapper = objectMapper;
        this.dataSource = dataSource;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.converterConnectTimeout());
        requestFactory.setReadTimeout(properties.converterReadTimeout());
        this.restClient =
                builder.baseUrl(properties.converterUrl()).requestFactory(requestFactory).build();
    }

    @Override
    public SlideConversionResult convert(
            StoredBlob source, String outputPrefix, UUID jobId, SlideConversionSink sink) {
        java.nio.file.Path stage;
        try {
            stage =
                    ConversionScratch.reserve(
                            conversionRoot,
                            jobId,
                            java.nio.file.Files.size(blobStorage.root().resolve(source.ref())),
                            dataSource);
        } catch (IOException error) {
            throw new IllegalStateException("Cannot reserve conversion scratch", error);
        }
        try {
            java.nio.file.Files.createDirectories(stage);
            java.nio.file.Files.setPosixFilePermissions(
                    stage, java.nio.file.attribute.PosixFilePermissions.fromString("rwxrwxrwx"));
            String suffix =
                    source.filename().contains(".")
                            ? source.filename().substring(source.filename().lastIndexOf('.'))
                            : ".bin";
            java.nio.file.Path stagedSource = stage.resolve("input" + suffix);
            withBlobSnapshotLock(
                    () -> {
                        try {
                            java.nio.file.Files.copy(
                                    blobStorage.root().resolve(source.ref()),
                                    stagedSource,
                                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                        } catch (IOException e) {
                            throw new IllegalStateException("Cannot stage document", e);
                        }
                        return null;
                    });
            SlideConversionSink stagedSink =
                    new SlideConversionSink() {
                        public void metadata(
                                int total, int rendered, String phase, String warning) {
                            sink.metadata(total, rendered, phase, warning);
                        }

                        public void slide(ConvertedSlide slide, int processed, int total) {
                            try {
                                java.nio.file.Path input =
                                        stage.resolve(slide.imageRef()).toRealPath();
                                if (!input.startsWith(stage.toRealPath())
                                        || java.nio.file.Files.size(input) > 32L * 1024 * 1024)
                                    throw new IllegalStateException("Invalid converter output");
                                String ref = outputPrefix + "/slide-" + slide.index() + ".png";
                                blobStorage.publish(input, ref, source.ref());
                                sink.slide(
                                        new ConvertedSlide(
                                                slide.index(),
                                                ref,
                                                slide.textExtract(),
                                                slide.placeholder()),
                                        processed,
                                        total);
                                java.nio.file.Files.deleteIfExists(input);
                            } catch (IOException e) {
                                throw new IllegalStateException(
                                        "Cannot publish converted slide", e);
                            }
                        }
                    };
            return restClient
                    .post()
                    .uri("/convert")
                    .header("X-Converter-Key", converterKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_NDJSON, MediaType.APPLICATION_JSON)
                    .body(
                            new ConvertRequest(
                                    stage.getFileName().toString(),
                                    stagedSource.toString(),
                                    stage.toString(),
                                    "output"))
                    .exchange(
                            (request, response) -> {
                                try (InputStream reader =
                                        new BufferedInputStream(response.getBody())) {
                                    var deadline =
                                            DEADLINES.schedule(
                                                    () -> {
                                                        try {
                                                            reader.close();
                                                        } catch (IOException ignored) {
                                                        }
                                                    },
                                                    360,
                                                    java.util.concurrent.TimeUnit.SECONDS);
                                    try {
                                        int statusCode = response.getStatusCode().value();
                                        if (statusCode == 429
                                                || statusCode == 502
                                                || statusCode == 503
                                                || statusCode == 504) {
                                            throw new RetryableImportException(
                                                    "Converter temporarily unavailable",
                                                    response.getHeaders().getFirst("Retry-After"));
                                        }
                                        if (!response.getStatusCode().is2xxSuccessful()) {
                                            throw new IllegalStateException(
                                                    "Converter failed: " + readError(reader));
                                        }
                                        return readEvents(reader, stagedSink);
                                    } finally {
                                        deadline.cancel(false);
                                    }
                                } catch (IOException exception) {
                                    throw new RetryableImportException(
                                            "Converter stream failed", exception);
                                }
                            });
        } catch (IOException e) {
            throw new IllegalStateException("Cannot stage conversion", e);
        } catch (org.springframework.web.client.ResourceAccessException exception) {
            throw new RetryableImportException("Converter connection failed", exception);
        } finally {
            try (var paths = java.nio.file.Files.walk(stage)) {
                for (var path : paths.sorted(java.util.Comparator.reverseOrder()).toList())
                    java.nio.file.Files.deleteIfExists(path);
            } catch (IOException ignored) {
                /* A bounded scratch quota contains abandoned jobs. */
            }
        }
    }

    private <T> T withBlobSnapshotLock(java.util.function.Supplier<T> operation) {
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement lock =
                    connection.prepareStatement("select pg_advisory_lock_shared(14713, 2525)")) {
                lock.execute();
            }
            RuntimeException operationFailure = null;
            try {
                return operation.get();
            } catch (RuntimeException exception) {
                operationFailure = exception;
                throw exception;
            } finally {
                try (PreparedStatement unlock =
                        connection.prepareStatement(
                                "select pg_advisory_unlock_shared(14713, 2525)")) {
                    unlock.execute();
                } catch (SQLException exception) {
                    if (operationFailure != null) {
                        operationFailure.addSuppressed(exception);
                    } else {
                        throw new IllegalStateException(
                                "Cannot release blob snapshot lock", exception);
                    }
                }
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Cannot acquire blob snapshot lock", exception);
        }
    }

    SlideConversionResult readEvents(InputStream reader, SlideConversionSink sink)
            throws IOException {
        int totalSlides = 0;
        int renderedSlides = 0;
        int processedSlides = 0;
        String warningMessage = null;
        String line;
        while ((line = readBoundedLine(reader, MAX_EVENT_BYTES)) != null) {
            if (line.isBlank()) {
                continue;
            }
            ConvertEvent event = objectMapper.readValue(line, ConvertEvent.class);
            switch (event.type()) {
                case "metadata" -> {
                    totalSlides = valueOrZero(event.totalSlides());
                    renderedSlides = valueOrZero(event.renderedSlides());
                    warningMessage = mergeWarnings(warningMessage, event.warningMessage());
                    sink.metadata(totalSlides, renderedSlides, event.phase(), warningMessage);
                }
                case "slide" -> {
                    processedSlides = valueOrZero(event.processedSlides());
                    totalSlides = Math.max(totalSlides, valueOrZero(event.totalSlides()));
                    sink.slide(
                            new ConvertedSlide(
                                    event.index(),
                                    event.imageRef(),
                                    event.textExtract() == null ? "" : event.textExtract(),
                                    Boolean.TRUE.equals(event.placeholder())),
                            processedSlides,
                            totalSlides);
                }
                case "warning" ->
                        warningMessage = mergeWarnings(warningMessage, event.warningMessage());
                case "error" -> {
                    String message =
                            firstNonBlank(
                                    event.errorMessage(), "Конвертер остановился во время импорта");
                    return new SlideConversionResult(
                            totalSlides,
                            processedSlides,
                            processedSlides > 0,
                            warningMessage,
                            message);
                }
                case "done" -> {
                    boolean partial = Boolean.TRUE.equals(event.partial());
                    warningMessage = mergeWarnings(warningMessage, event.warningMessage());
                    return new SlideConversionResult(
                            valueOrDefault(event.totalSlides(), totalSlides),
                            valueOrDefault(event.renderedSlides(), processedSlides),
                            partial,
                            warningMessage,
                            event.errorMessage());
                }
                default ->
                        throw new IllegalStateException("Unknown converter event: " + event.type());
            }
        }
        if (processedSlides > 0) {
            return new SlideConversionResult(
                    totalSlides,
                    processedSlides,
                    true,
                    warningMessage,
                    "Конвертер оборвал поток после " + processedSlides + " слайдов");
        }
        throw new IllegalStateException("Converter returned no slides");
    }

    String readError(InputStream reader) throws IOException {
        byte[] bytes = reader.readNBytes(MAX_ERROR_BYTES);
        String body = new String(bytes, StandardCharsets.UTF_8);
        if (body.isBlank()) return "empty response";
        try {
            ConvertEvent event = objectMapper.readValue(body, ConvertEvent.class);
            return firstNonBlank(event.errorMessage(), body);
        } catch (IOException ignored) {
            return body;
        }
    }

    static String readBoundedLine(InputStream input, int maximumBytes) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream(Math.min(8192, maximumBytes));
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (line.size() >= maximumBytes) {
                // This is a deterministic malformed/oversized result, not a transient network
                // fault.
                throw new IllegalStateException("Converter event exceeds the byte limit");
            }
            line.write(value);
        }
        if (value == -1 && line.size() == 0) return null;
        byte[] bytes = line.toByteArray();
        int length =
                bytes.length > 0 && bytes[bytes.length - 1] == '\r'
                        ? bytes.length - 1
                        : bytes.length;
        return new String(bytes, 0, length, StandardCharsets.UTF_8);
    }

    private String mergeWarnings(String current, String next) {
        if (next == null || next.isBlank()) return current;
        if (current == null || current.isBlank()) return next;
        if (current.contains(next)) return current;
        String combined = next.contains(current) ? next : current + " " + next;
        return combined.substring(0, Math.min(16384, combined.length()));
    }

    private int valueOrZero(Integer value) {
        return value == null ? 0 : value;
    }

    private int valueOrDefault(Integer value, int fallback) {
        return value == null ? fallback : value;
    }

    private String firstNonBlank(String current, String next) {
        if (current != null && !current.isBlank()) {
            return current;
        }
        return next == null || next.isBlank() ? current : next;
    }

    private record ConvertRequest(
            String jobId, String sourcePath, String outputDir, String outputPrefix) {}

    private record ConvertEvent(
            String type,
            Integer totalSlides,
            Integer renderedSlides,
            Integer processedSlides,
            String phase,
            Integer index,
            String imageRef,
            String textExtract,
            Boolean placeholder,
            Boolean partial,
            String warningMessage,
            String errorMessage) {}
}
