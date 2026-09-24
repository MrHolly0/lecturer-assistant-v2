-- B-03: одноразовый код, которым преподаватель в браузере привязывает свой MAX-аккаунт
-- к уже существующей личности. Отдельная таблица от iam.identity_link_codes (та обслуживает
-- вход через мессенджеры произвольным channelType) — коды разного назначения не должны
-- быть взаимозаменяемы между /api/v1/identity/link и /api/v1/auth/max.
CREATE TABLE iam.max_link_codes (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
