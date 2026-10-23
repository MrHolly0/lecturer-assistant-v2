package ru.university.assistant.content.internal;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.StudentSlideReadApi;
import ru.university.assistant.content.api.StudentSlideView;

/** Bounded raw-slide cache. A database revision is checked before every read; URLs are signed afresh. */
@Service
class StudentSlideReadService implements StudentSlideReadApi {
    private static final int MAXIMUM_ENTRIES = 1024;
    private static final long MAXIMUM_BYTES = 16 * 1024 * 1024;
    private final JdbcClient jdbc;
    private final SignedSlideUrlService signedUrls;
    private final Map<Key, RawSlide> cache = new LinkedHashMap<>(16, 0.75f, true);
    private long cachedBytes;
    private final Counter hits;
    private final Counter misses;

    StudentSlideReadService(JdbcClient jdbc, SignedSlideUrlService signedUrls, MeterRegistry meters) {
        this.jdbc = jdbc; this.signedUrls = signedUrls;
        hits = meters.counter("live.student.slide_cache", "result", "hit");
        misses = meters.counter("live.student.slide_cache", "result", "miss");
        meters.gauge("live.student.slide_cache.bytes", this, value -> value.cachedBytes());
    }

    @Override
    public StudentSlideView slide(UUID courseId, UUID deckId, int slideIndex) {
        long revision = jdbc.sql("""
                select read_revision from content.slide_decks where course_id = :course and id = :deck
                """)
                .param("course", courseId).param("deck", deckId).query(Long.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
        Key key = new Key(courseId, deckId, slideIndex, revision);
        boolean cacheable = !TransactionSynchronizationManager.isActualTransactionActive();
        RawSlide raw = cacheable ? cached(key) : null;
        if (raw == null) {
            misses.increment();
            raw = jdbc.sql("""
                    select s.id, s.idx, s.text_extract,
                        (select count(*)::int from content.slides where deck_id = :deck) as slide_count
                    from content.slides s where s.deck_id = :deck
                    order by case when s.idx = :idx then 0 else 1 end, s.idx limit 1
                    """)
                    .param("deck", deckId).param("idx", slideIndex)
                    .query((rs, row) -> new RawSlide(rs.getObject("id", UUID.class), rs.getInt("idx"),
                            rs.getString("text_extract"), rs.getInt("slide_count"))).optional()
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "Session deck has no slides"));
            if (cacheable) remember(key, raw);
        } else hits.increment();
        String url = signedUrls.slideImageUrl(courseId, deckId, raw.id(), raw.idx(),
                signedUrls.token(courseId, deckId));
        return new StudentSlideView(raw.slideCount(), new Slide(raw.id(), deckId, raw.idx(), url, raw.text(), null));
    }

    private synchronized RawSlide cached(Key key) { return cache.get(key); }
    private synchronized long cachedBytes() { return cachedBytes; }
    private synchronized void remember(Key key, RawSlide value) {
        if (value.bytes() > MAXIMUM_BYTES) return;
        cache.entrySet().removeIf(entry -> {
            if (entry.getKey().deck().equals(key.deck()) && entry.getKey().revision() != key.revision()) {
                cachedBytes -= entry.getValue().bytes(); return true;
            }
            return false;
        });
        RawSlide previous = cache.put(key, value);
        cachedBytes += value.bytes() - (previous == null ? 0 : previous.bytes());
        while (cache.size() > MAXIMUM_ENTRIES || cachedBytes > MAXIMUM_BYTES) {
            var iterator = cache.entrySet().iterator();
            cachedBytes -= iterator.next().getValue().bytes(); iterator.remove();
        }
    }

    private record Key(UUID course, UUID deck, int idx, long revision) {}
    private record RawSlide(UUID id, int idx, String text, int slideCount) {
        long bytes() { return 128 + (text == null ? 0 : 2L * text.length()); }
    }
}
