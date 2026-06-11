package ru.university.assistant.content.internal;

import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
@ConditionalOnProperty(prefix = "app.content", name = "converter-url")
class HttpSlideConversionClient implements SlideConversionClient {
    private final BlobStorage blobStorage;
    private final ContentProperties properties;
    private final RestClient restClient;

    HttpSlideConversionClient(BlobStorage blobStorage, ContentProperties properties, RestClient.Builder builder) {
        this.blobStorage = blobStorage;
        this.properties = properties;
        this.restClient = builder.baseUrl(properties.converterUrl()).build();
    }

    @Override
    public List<ConvertedSlide> convert(StoredBlob source, String outputPrefix) {
        ConvertResponse response = restClient.post()
                .uri("/convert")
                .body(new ConvertRequest(
                        blobStorage.root().resolve(source.ref()).toString(),
                        blobStorage.root().toString(),
                        outputPrefix))
                .retrieve()
                .body(ConvertResponse.class);
        if (response == null || response.slides() == null || response.slides().isEmpty()) {
            throw new IllegalStateException("Converter returned no slides");
        }
        return response.slides();
    }

    private record ConvertRequest(String sourcePath, String outputDir, String outputPrefix) {}

    private record ConvertResponse(List<ConvertedSlide> slides) {}
}
