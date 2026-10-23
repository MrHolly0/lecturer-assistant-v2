package ru.university.assistant.content.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class HttpSlideConversionBoundsTest {
    private final HttpSlideConversionClient client = new HttpSlideConversionClient(mock(BlobStorage.class),
            new ContentProperties(null, "http://localhost:8000", 1024, "unused", Duration.ofHours(1),
                    Duration.ofSeconds(1), Duration.ofSeconds(1), 1, 1, 1, 128),
            RestClient.builder(), new ObjectMapper(), mock(DataSource.class));

    @Test
    void boundedLinePreservesUnicodeCrlfAndFinalRecordWithoutNewline() throws Exception {
        var input = stream("Первый\r\n\nПоследний");
        assertEquals("Первый", HttpSlideConversionClient.readBoundedLine(input, 128));
        assertEquals("", HttpSlideConversionClient.readBoundedLine(input, 128));
        assertEquals("Последний", HttpSlideConversionClient.readBoundedLine(input, 128));
        assertNull(HttpSlideConversionClient.readBoundedLine(input, 128));
        assertThrows(IllegalStateException.class,
                () -> HttpSlideConversionClient.readBoundedLine(stream("😀😀"), 7));
    }

    @Test
    void oversizedEventIsTerminalAfterAlreadyDeliveredSlides() throws Exception {
        List<ConvertedSlide> slides = new ArrayList<>();
        var input = stream("{\"type\":\"slide\",\"index\":1,\"imageRef\":\"a.png\","
                + "\"processedSlides\":1,\"totalSlides\":2,\"textExtract\":\"OK\"}\n"
                + "x".repeat(HttpSlideConversionClient.MAX_EVENT_BYTES + 1));
        var failure = assertThrows(IllegalStateException.class, () -> client.readEvents(input, sink(slides)));
        assertEquals(IllegalStateException.class, failure.getClass());
        assertEquals(1, slides.size());
        assertEquals("a.png", slides.getFirst().imageRef());
    }

    @Test
    void eofAfterSlideReturnsPartialAndLaterTruncationWarningIsNotLost() throws Exception {
        var eof = client.readEvents(stream("{\"type\":\"slide\",\"index\":1,\"imageRef\":\"a.png\","
                + "\"processedSlides\":1,\"totalSlides\":2}"), sink(new ArrayList<>()));
        assertTrue(eof.partial());
        assertEquals(1, eof.renderedSlides());
        var result = client.readEvents(stream("{\"type\":\"metadata\",\"warningMessage\":\"Large deck\"}\n"
                + "{\"type\":\"done\",\"warningMessage\":\"Large deck. Text truncated\",\"renderedSlides\":1}"),
                sink(new ArrayList<>()));
        assertTrue(result.warningMessage().contains("Text truncated"));
    }

    @Test
    void hugeErrorBodyReadsAtMostSixteenKibibytes() throws Exception {
        var input = stream("x".repeat(HttpSlideConversionClient.MAX_ERROR_BYTES * 3));
        String error = client.readError(input);
        assertEquals(HttpSlideConversionClient.MAX_ERROR_BYTES, error.length());
        assertEquals(HttpSlideConversionClient.MAX_ERROR_BYTES * 2, input.available());
    }

    private static ByteArrayInputStream stream(String value) {
        return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
    }

    private static SlideConversionSink sink(List<ConvertedSlide> slides) {
        return new SlideConversionSink() {
            @Override
            public void metadata(int total, int rendered, String phase, String warning) {}
            @Override
            public void slide(ConvertedSlide slide, int processed, int total) { slides.add(slide); }
        };
    }
}
