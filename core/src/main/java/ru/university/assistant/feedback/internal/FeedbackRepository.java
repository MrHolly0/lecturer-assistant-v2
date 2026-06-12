package ru.university.assistant.feedback.internal;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.feedback.api.SignalValue;
import ru.university.assistant.shared.api.UuidV7;

@Repository
class FeedbackRepository {
    private final JdbcClient jdbc;

    FeedbackRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void saveSignal(UUID sessionId, UUID personId, String channelType, SignalValue value) {
        jdbc.sql(
                        """
                        insert into feedback.comprehension_signals (id, session_id, person_id, channel_type, value)
                        values (:id, :sessionId, :personId, :channelType, :value)
                        """)
                .param("id", UuidV7.generate())
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("channelType", channelType)
                .param("value", value.name())
                .update();
    }

    SignalAggregate aggregate(UUID sessionId) {
        return jdbc.sql(
                        """
                        with latest as (
                            select distinct on (person_id) person_id, value
                            from feedback.comprehension_signals
                            where session_id = :sessionId
                            order by person_id, created_at desc
                        )
                        select
                            count(*) filter (where value = 'GREEN')::int as green,
                            count(*) filter (where value = 'YELLOW')::int as yellow,
                            count(*) filter (where value = 'RED')::int as red,
                            count(*)::int as total
                        from latest
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new SignalAggregate(
                        rs.getInt("green"), rs.getInt("yellow"), rs.getInt("red"), rs.getInt("total")))
                .single();
    }
}
