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
    private final BlobStorage blobStorage;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final DataSource dataSource;

    HttpSlideConversionClient(
            BlobStorage blobStorage,
            ContentProperties properties,
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            DataSource dataSource) {
        this.blobStorage = blobStorage;
        this.objectMapper = objectMapper;
        this.dataSource = dataSource;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.converterConnectTimeout());
        requestFactory.setReadTimeout(properties.converterReadTimeout());
        this.restClient = builder.baseUrl(properties.converterUrl()).requestFactory(requestFactory).build();
    }

    @Override
    public SlideConversionResult convert(
            StoredBlob source, String outputPrefix, UUID jobId, SlideConversionSink sink) {
        try {
            return withBlobSnapshotLock(() -> restClient.post()
                .uri("/convert")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_NDJSON, MediaType.APPLICATION_JSON)
                .body(new ConvertRequest(
                        jobId.toString(),
                        blobStorage.root().resolve(source.ref()).toString(),
                        blobStorage.root().toString(),
                        outputPrefix))
                .exchange((request, response) -> {
                    try (InputStream reader = new BufferedInputStream(response.getBody())) {
                        int statusCode = response.getStatusCode().value();
                        if (statusCode == 429 || statusCode == 502 || statusCode == 503 || statusCode == 504) {
                            throw new RetryableImportException("Converter temporarily unavailable",
                                    response.getHeaders().getFirst("Retry-After"));
                        }
                        if (!response.getStatusCode().is2xxSuccessful()) {
                            throw new IllegalStateException("Converter failed: " + readError(reader));
                        }
                        return readEvents(reader, sink);
                    } catch (IOException exception) {
                        throw new RetryableImportException("Converter stream failed", exception);
                    }
                }));
        } catch (org.springframework.web.client.ResourceAccessException exception) {
            throw new RetryableImportException("Converter connection failed", exception);
        }
    }

    private <T> T withBlobSnapshotLock(java.util.function.Supplier<T> operation) {
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement lock = connection.prepareStatement("select pg_advisory_lock_shared(14713, 2525)")) {
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
                        connection.prepareStatement("select pg_advisory_unlock_shared(14713, 2525)")) {
                    unlock.execute();
                } catch (SQLException exception) {
                    if (operationFailure != null) {
                        operationFailure.addSuppressed(exception);
                    } else {
                        throw new IllegalStateException("Cannot release blob snapshot lock", exception);
                    }
                }
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Cannot acquire blob snapshot lock", exception);
        }
    }

    SlideConversionResult readEvents(InputStream reader, SlideConversionSink sink) throws IOException {
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
                    sink.slide(new ConvertedSlide(
                                    event.index(),
                                    event.imageRef(),
                                    event.textExtract() == null ? "" : event.textExtract(),
                                    Boolean.TRUE.equals(event.placeholder())),
                            processedSlides,
                            totalSlides);
                }
                case "warning" -> warningMessage = mergeWarnings(warningMessage, event.warningMessage());
                case "error" -> {
                    String message = firstNonBlank(event.errorMessage(), "Конвертер остановился во время импорта");
                    return new SlideConversionResult(totalSlides, processedSlides, processedSlides > 0, warningMessage,
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
                default -> throw new IllegalStateException("Unknown converter event: " + event.type());
            }
        }
        if (processedSlides > 0) {
            return new SlideConversionResult(totalSlides, processedSlides, true, warningMessage,
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
                // This is a deterministic malformed/oversized result, not a transient network fault.
                throw new IllegalStateException("Converter event exceeds the byte limit");
            }
            line.write(value);
        }
        if (value == -1 && line.size() == 0) return null;
        byte[] bytes = line.toByteArray();
        int length = bytes.length > 0 && bytes[bytes.length - 1] == '\r' ? bytes.length - 1 : bytes.length;
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

    private record ConvertRequest(String jobId, String sourcePath, String outputDir, String outputPrefix) {}

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
