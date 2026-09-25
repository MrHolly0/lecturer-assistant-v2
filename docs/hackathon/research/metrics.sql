-- Пилотная выгрузка по последней тестовой лекции.
-- PostgreSQL 16. Запросы возвращают только агрегаты, без имён и MAX id.
-- Для пилота название лекции должно содержать "ТЕСТ". Если тестовых сессий несколько,
-- выбирается последняя запущенная. Число фактически присутствовавших берётся у наблюдателя
-- и в БД отсутствует, поэтому доля вошедших здесь не рассчитывается.

-- 1. Паспорт лекции и основные доли участия.
WITH target_session AS (
    SELECT s.id, s.join_code, s.started_at, s.ended_at, l.title
    FROM live.sessions s
    JOIN live.lectures l ON l.id = s.lecture_id
    WHERE l.title ILIKE '%тест%'
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1
), participants AS (
    SELECT DISTINCT sp.person_id
    FROM live.session_participants sp
    JOIN target_session t ON t.id = sp.session_id
    WHERE NOT sp.kicked
), signal_senders AS (
    SELECT DISTINCT e.actor_person_id AS person_id
    FROM analytics.events e
    JOIN target_session t ON e.context ->> 'sessionId' = t.id::text
    WHERE e.verb = 'feedback.signal_submitted'
), poll_respondents AS (
    SELECT DISTINCT e.actor_person_id AS person_id
    FROM analytics.events e
    JOIN target_session t ON e.context ->> 'sessionId' = t.id::text
    WHERE e.verb = 'interaction.poll_answered'
), question_askers AS (
    SELECT DISTINCT e.actor_person_id AS person_id
    FROM analytics.events e
    JOIN target_session t ON e.context ->> 'sessionId' = t.id::text
    WHERE e.verb = 'qa.question_asked'
)
SELECT
    t.id AS session_id,
    t.title AS lecture_title,
    t.started_at,
    t.ended_at,
    EXTRACT(EPOCH FROM (t.ended_at - t.started_at))::bigint AS duration_seconds,
    (SELECT count(*) FROM participants) AS participant_count,
    (SELECT count(*) FROM signal_senders) AS students_with_signal,
    round((SELECT count(*) FROM signal_senders)::numeric
          / NULLIF((SELECT count(*) FROM participants), 0), 4) AS signal_participation_rate,
    (SELECT count(*) FROM poll_respondents) AS students_with_poll_answer,
    round((SELECT count(*) FROM poll_respondents)::numeric
          / NULLIF((SELECT count(*) FROM participants), 0), 4) AS poll_participation_rate,
    (SELECT count(*) FROM question_askers) AS students_with_question
FROM target_session t;

-- 2. Время от открытия miniapp по start_param до регистрации участника.
-- Событие miniapp.opened появится после того, как web начнёт передавать startParam в POST /auth/max.
WITH target_session AS (
    SELECT s.id, s.join_code
    FROM live.sessions s
    JOIN live.lectures l ON l.id = s.lecture_id
    WHERE l.title ILIKE '%тест%'
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1
), opened AS (
    SELECT e.actor_person_id, min(e.occurred_at) AS opened_at
    FROM analytics.events e
    JOIN target_session t ON upper(e.context ->> 'startParam') = upper(t.join_code)
    WHERE e.verb = 'miniapp.opened'
    GROUP BY e.actor_person_id
), joined AS (
    SELECT e.actor_person_id, min(e.occurred_at) AS joined_at
    FROM analytics.events e
    JOIN target_session t ON e.context ->> 'sessionId' = t.id::text
    WHERE e.verb = 'participant.joined'
    GROUP BY e.actor_person_id
), latency AS (
    SELECT EXTRACT(EPOCH FROM (j.joined_at - o.opened_at)) AS seconds
    FROM opened o
    JOIN joined j USING (actor_person_id)
    WHERE j.joined_at >= o.opened_at
)
SELECT
    count(*) AS measured_students,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median_entry_seconds,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds) AS p90_entry_seconds
FROM latency;

-- 3. Проблемные слайды: только слайды хотя бы с одним RED, по убыванию RED.
WITH target_session AS (
    SELECT s.id
    FROM live.sessions s
    JOIN live.lectures l ON l.id = s.lecture_id
    WHERE l.title ILIKE '%тест%'
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1
)
SELECT
    cs.slide_idx,
    count(*) FILTER (WHERE cs.value = 'GREEN') AS green,
    count(*) FILTER (WHERE cs.value = 'YELLOW') AS yellow,
    count(*) FILTER (WHERE cs.value = 'RED') AS red,
    count(*) AS total_signals
FROM feedback.comprehension_signals cs
JOIN target_session t ON t.id = cs.session_id
GROUP BY cs.slide_idx
HAVING count(*) FILTER (WHERE cs.value = 'RED') > 0
ORDER BY red DESC, cs.slide_idx;

-- 4. Результаты всех проверок: ответы, участие и доля верных.
WITH target_session AS (
    SELECT s.id
    FROM live.sessions s
    JOIN live.lectures l ON l.id = s.lecture_id
    WHERE l.title ILIKE '%тест%'
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1
), participant_count AS (
    SELECT count(DISTINCT sp.person_id)::numeric AS value
    FROM live.session_participants sp
    JOIN target_session t ON t.id = sp.session_id
    WHERE NOT sp.kicked
)
SELECT
    p.id AS poll_id,
    p.source_question_id,
    p.question_text,
    p.created_at AS started_at,
    p.closed_at,
    count(r.id) AS responses,
    round(count(r.id)::numeric / NULLIF(pc.value, 0), 4) AS response_rate,
    count(r.id) FILTER (WHERE r.option_idx = p.correct_option_idx) AS correct_responses,
    round(count(r.id) FILTER (WHERE r.option_idx = p.correct_option_idx)::numeric
          / NULLIF(count(r.id), 0), 4) AS correct_rate
FROM interaction.quick_polls p
JOIN target_session t ON t.id = p.session_id
CROSS JOIN participant_count pc
LEFT JOIN interaction.poll_responses r ON r.poll_id = p.id
GROUP BY p.id, p.source_question_id, p.question_text, p.created_at, p.closed_at, pc.value
ORDER BY p.created_at;

-- 5. Реакция на всплеск RED. Порог пилота: три разных студента на одном слайде.
-- Реакция — первый запуск проверки либо возврат преподавателя на этот слайд.
WITH target_session AS (
    SELECT s.id
    FROM live.sessions s
    JOIN live.lectures l ON l.id = s.lecture_id
    WHERE l.title ILIKE '%тест%'
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1
), first_red AS (
    SELECT
        (e.payload ->> 'slideIdx')::integer AS slide_idx,
        e.actor_person_id,
        min(e.occurred_at) AS occurred_at
    FROM analytics.events e
    JOIN target_session t ON e.context ->> 'sessionId' = t.id::text
    WHERE e.verb = 'feedback.signal_submitted'
      AND e.payload ->> 'value' = 'RED'
    GROUP BY (e.payload ->> 'slideIdx')::integer, e.actor_person_id
), ranked_red AS (
    SELECT *, row_number() OVER (PARTITION BY slide_idx ORDER BY occurred_at) AS red_rank
    FROM first_red
), spikes AS (
    SELECT slide_idx, occurred_at AS threshold_at
    FROM ranked_red
    WHERE red_rank = 3
), reactions AS (
    SELECT
        s.slide_idx,
        s.threshold_at,
        reaction.occurred_at AS reacted_at,
        reaction.verb AS reaction
    FROM spikes s
    LEFT JOIN LATERAL (
        SELECT e.occurred_at, e.verb
        FROM analytics.events e
        JOIN target_session t ON e.context ->> 'sessionId' = t.id::text
        WHERE e.occurred_at >= s.threshold_at
          AND (
              e.verb = 'interaction.poll_started'
              OR (e.verb = 'session.slide_changed' AND (e.payload ->> 'to')::integer = s.slide_idx)
          )
        ORDER BY e.occurred_at
        LIMIT 1
    ) reaction ON true
)
SELECT
    slide_idx,
    threshold_at,
    reacted_at,
    reaction,
    EXTRACT(EPOCH FROM (reacted_at - threshold_at)) AS reaction_seconds
FROM reactions
ORDER BY threshold_at;

-- 6. Контроль полноты событий для выбранной тестовой лекции.
WITH target_session AS (
    SELECT s.id, s.join_code
    FROM live.sessions s
    JOIN live.lectures l ON l.id = s.lecture_id
    WHERE l.title ILIKE '%тест%'
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1
)
SELECT e.verb, count(*) AS event_count
FROM analytics.events e
CROSS JOIN target_session t
WHERE e.context ->> 'sessionId' = t.id::text
   OR upper(e.context ->> 'startParam') = upper(t.join_code)
GROUP BY e.verb
ORDER BY e.verb;
