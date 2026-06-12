DELETE FROM feedback.comprehension_signals older
USING feedback.comprehension_signals newer
WHERE older.session_id = newer.session_id
  AND older.person_id = newer.person_id
  AND (
      older.created_at < newer.created_at
      OR (older.created_at = newer.created_at AND older.id < newer.id)
  );

ALTER TABLE feedback.comprehension_signals
    ADD CONSTRAINT uq_comprehension_signals_session_person UNIQUE (session_id, person_id);
