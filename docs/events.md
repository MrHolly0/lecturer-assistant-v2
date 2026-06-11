# Словарь событий

Все события пишутся append-only в `analytics.events`; параллельно создаётся запись в `analytics.outbox`.

| Verb | Aggregate | Когда пишется |
| --- | --- | --- |
| `session.started` | `live.session` | Лектор или ассистент стартовал live-сессию |
| `session.slide_changed` | `live.session` | Презентер сменил текущий слайд |
| `session.paused` | `live.session` | Сессия поставлена на паузу |
| `session.resumed` | `live.session` | Сессия продолжена после паузы |
| `session.ended` | `live.session` | Сессия завершена |
| `session.archived` | `live.session` | Сессия архивирована |
| `participant.joined` | `live.session` | Участник вошёл по join-code |
| `slide.annotations_updated` | `live.session` | Сохранён новый слой рисования |

Минимальный context: `courseId`, `sessionId`, `lectureId`.

Payload зависит от события: например `session.slide_changed` хранит `from/to`, а `participant.joined` — `channelType`.
