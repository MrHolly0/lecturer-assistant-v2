package ru.university.assistant.feedback.internal;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.feedback.api.ProblemSlide;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.feedback.api.SignalValue;
import ru.university.assistant.shared.api.UuidV7;

@Repository
class FeedbackRepository {
    private final JdbcClient jdbc;

    FeedbackRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void saveSignal(UUID sessionId, UUID personId, String channelType, int slideIdx, SignalValue value) {
        jdbc.sql(
                        """
                        insert into feedback.comprehension_signals
                            (id, session_id, person_id, channel_type, slide_idx, value)
                        values (:id, :sessionId, :personId, :channelType, :slideIdx, :value)
                        on conflict (session_id, person_id, slide_idx)
                        do update set
                            channel_type = excluded.channel_type,
                            value = excluded.value,
                            created_at = now()
                        """)
                .param("id", UuidV7.generate())
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("channelType", channelType)
                .param("slideIdx", slideIdx)
                .param("value", value.name())
                .update();
    }

    // Уникальность (session_id, person_id, slide_idx) гарантирует не больше одной строки на
    // человека на слайд, поэтому агрегат — обычный count без дедупликации по последней записи.
    SignalAggregate aggregate(UUID sessionId, int slideIdx) {
        return jdbc.sql(
                        """
                        select
                            count(*) filter (where value = 'GREEN')::int as green,
                            count(*) filter (where value = 'YELLOW')::int as yellow,
                            count(*) filter (where value = 'RED')::int as red,
                            count(*)::int as total
                        from feedback.comprehension_signals
                        where session_id = :sessionId and slide_idx = :slideIdx
                        """)
                .param("sessionId", sessionId)
                .param("slideIdx", slideIdx)
                .query((rs, row) -> new SignalAggregate(
                        rs.getInt("green"), rs.getInt("yellow"), rs.getInt("red"), rs.getInt("total")))
                .single();
    }

    List<ProblemSlide> problemSlides(UUID sessionId) {
        return jdbc.sql(
                        """
                        select
                            slide_idx,
                            count(*) filter (where value = 'GREEN')::int as green,
                            count(*) filter (where value = 'YELLOW')::int as yellow,
                            count(*) filter (where value = 'RED')::int as red,
                            count(*)::int as total
                        from feedback.comprehension_signals
                        where session_id = :sessionId
                        group by slide_idx
                        order by red desc, slide_idx asc
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new ProblemSlide(
                        rs.getInt("slide_idx"),
                        new SignalAggregate(
                                rs.getInt("green"), rs.getInt("yellow"), rs.getInt("red"), rs.getInt("total"))))
                .list();
    }
}
