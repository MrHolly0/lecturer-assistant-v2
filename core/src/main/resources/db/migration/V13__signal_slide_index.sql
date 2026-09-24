-- D-04: сигнал понимания раньше был одной строкой на человека на всю лекцию, без номера
-- слайда, и не сбрасывался при смене слайда. Добавляем номер слайда и переносим уникальность
-- на тройку (сессия, человек, слайд) — тогда сброс актуального состояния при смене слайда
-- получается сам собой: агрегат считается по текущему слайду, а не по всей сессии.
-- Старые строки данных стенда не жалко — обнуляем номер слайда.
ALTER TABLE feedback.comprehension_signals ADD COLUMN slide_idx integer;
UPDATE feedback.comprehension_signals SET slide_idx = 0 WHERE slide_idx IS NULL;
ALTER TABLE feedback.comprehension_signals ALTER COLUMN slide_idx SET NOT NULL;

ALTER TABLE feedback.comprehension_signals
    DROP CONSTRAINT uq_comprehension_signals_session_person;
ALTER TABLE feedback.comprehension_signals
    ADD CONSTRAINT uq_comprehension_signals_session_person_slide UNIQUE (session_id, person_id, slide_idx);

-- Список проблемных слайдов (сколько красных сигналов на каждом) — под сводку B-08 и B-17.
CREATE INDEX idx_comprehension_signals_session_slide ON feedback.comprehension_signals(session_id, slide_idx);
