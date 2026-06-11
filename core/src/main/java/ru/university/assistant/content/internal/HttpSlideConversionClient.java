package ru.university.assistant.content.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestClient;

@Component
@ConditionalOnProperty(prefix = "app.content", name = "converter-url")
class HttpSlideConversionClient implements SlideConversionClient {
    private final BlobStorage blobStorage;
    private final ContentProperties properties;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    HttpSlideConversionClient(
            BlobStorage blobStorage,
            ContentProperties properties,
            RestClient.Builder builder,
            ObjectMapper objectMapper) {
        this.blobStorage = blobStorage;
        this.properties = properties;
        this.restClient = builder.baseUrl(properties.converterUrl()).build();
        this.objectMapper = objectMapper;
    }

    @Override
    public List<ConvertedSlide> convert(StoredBlob source, String outputPrefix) {
        ConvertResponse response;
        try {
            response = restClient.post()
                    .uri("/convert")
                    .body(new ConvertRequest(
                            blobStorage.root().resolve(source.ref()).toString(),
                            blobStorage.root().toString(),
                            outputPrefix))
                    .retrieve()
                    .body(ConvertResponse.class);
        } catch (RestClientResponseException exception) {
            throw new IllegalStateException("Converter failed: " + converterMessage(exception), exception);
        }
        if (response == null || response.slides() == null || response.slides().isEmpty()) {
            throw new IllegalStateException("Converter returned no slides");
        }
        return response.slides();
    }

    private String converterMessage(RestClientResponseException exception) {
        try {
            ConvertError error = objectMapper.readValue(exception.getResponseBodyAsString(), ConvertError.class);
            if (error.error() != null && !error.error().isBlank()) {
                return error.error();
            }
        } catch (JsonProcessingException ignored) {
            // Fall through to the HTTP status when the converter response is not JSON.
        }
        return exception.getStatusCode().toString();
    }

    private record ConvertRequest(String sourcePath, String outputDir, String outputPrefix) {}

    private record ConvertResponse(List<ConvertedSlide> slides) {}

    private record ConvertError(String error) {}
}
