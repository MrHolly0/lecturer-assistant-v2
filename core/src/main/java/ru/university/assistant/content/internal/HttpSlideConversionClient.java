package ru.university.assistant.content.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
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
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                            response.getBody(), StandardCharsets.UTF_8))) {
                        if (!response.getStatusCode().is2xxSuccessful()) {
                            throw new IllegalStateException("Converter failed: " + readError(reader));
                        }
                        return readEvents(reader, sink);
                    } catch (IOException exception) {
                        throw new IllegalStateException("Converter stream failed", exception);
                    }
                }));
    }

    private <T> T withBlobSnapshotLock(java.util.function.Supplier<T> operation) {
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement lock = connection.prepareStatement("select pg_advisory_lock(14713, 2525)")) {
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
                        connection.prepareStatement("select pg_advisory_unlock(14713, 2525)")) {
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

    private SlideConversionResult readEvents(BufferedReader reader, SlideConversionSink sink) throws IOException {
        int totalSlides = 0;
        int renderedSlides = 0;
        int processedSlides = 0;
        String warningMessage = null;
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isBlank()) {
                continue;
            }
            ConvertEvent event = objectMapper.readValue(line, ConvertEvent.class);
            switch (event.type()) {
                case "metadata" -> {
                    totalSlides = valueOrZero(event.totalSlides());
                    renderedSlides = valueOrZero(event.renderedSlides());
                    warningMessage = firstNonBlank(warningMessage, event.warningMessage());
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
                case "warning" -> warningMessage = firstNonBlank(warningMessage, event.warningMessage());
                case "error" -> {
                    String message = firstNonBlank(event.errorMessage(), "Конвертер остановился во время импорта");
                    return new SlideConversionResult(totalSlides, processedSlides, processedSlides > 0, warningMessage,
                            message);
                }
                case "done" -> {
                    boolean partial = Boolean.TRUE.equals(event.partial());
                    warningMessage = firstNonBlank(warningMessage, event.warningMessage());
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

    private String readError(BufferedReader reader) throws IOException {
        String body = reader.lines().reduce("", (left, right) -> left + right);
        if (body.isBlank()) {
            return "empty response";
        }
        try {
            ConvertEvent event = objectMapper.readValue(body, ConvertEvent.class);
            return firstNonBlank(event.errorMessage(), body);
        } catch (IOException ignored) {
            return body;
        }
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
