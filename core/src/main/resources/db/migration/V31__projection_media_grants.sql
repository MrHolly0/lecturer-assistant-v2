ALTER TABLE projection.commands
    ADD COLUMN view_token_hash varchar(64),
    ADD COLUMN view_token_expires_at timestamptz;

CREATE UNIQUE INDEX projection_view_tokens ON projection.commands(view_token_hash)
    WHERE view_token_hash IS NOT NULL;
