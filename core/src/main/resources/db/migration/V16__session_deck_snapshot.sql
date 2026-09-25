ALTER TABLE live.sessions ADD COLUMN deck_id uuid REFERENCES content.slide_decks(id);

UPDATE live.sessions s
SET deck_id = l.deck_id
FROM live.lectures l
WHERE l.id = s.lecture_id;

ALTER TABLE live.sessions ALTER COLUMN deck_id SET NOT NULL;

CREATE INDEX idx_sessions_deck ON live.sessions(deck_id, created_at DESC);
