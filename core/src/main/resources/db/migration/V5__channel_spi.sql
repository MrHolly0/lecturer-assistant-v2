ALTER TABLE iam.channel_identities DROP CONSTRAINT channel_identities_channel_type_check;
ALTER TABLE iam.channel_identities
    ADD CONSTRAINT channel_identities_channel_type_check
    CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo'));

CREATE TABLE channel.channel_capabilities (
    channel_type text PRIMARY KEY CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo')),
    inline_buttons boolean NOT NULL,
    edit_message boolean NOT NULL,
    images boolean NOT NULL,
    max_text_length integer NOT NULL CHECK (max_text_length > 0),
    max_buttons_per_row integer NOT NULL CHECK (max_buttons_per_row > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE channel.outbox (
    id uuid PRIMARY KEY,
    channel_type text NOT NULL CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo')),
    channel_identity_id uuid NOT NULL REFERENCES iam.channel_identities(id) ON DELETE CASCADE,
    priority text NOT NULL CHECK (priority IN ('P0_INTERACTIVE', 'P1_ACTIVITY', 'P2_SLIDE', 'P3_BULK')),
    content jsonb NOT NULL,
    keyboard jsonb NOT NULL DEFAULT '[]'::jsonb,
    reply_mode text NOT NULL CHECK (reply_mode IN ('NEW', 'EDIT_LAST')),
    thread_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('QUEUED', 'IN_FLIGHT', 'DELIVERED', 'FAILED', 'DLQ')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    adapter_message_id text,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);

CREATE TABLE channel.delivery_reports (
    id uuid PRIMARY KEY,
    outbox_id uuid NOT NULL REFERENCES channel.outbox(id) ON DELETE CASCADE,
    channel_type text NOT NULL CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo')),
    status text NOT NULL CHECK (status IN ('DELIVERED', 'FAILED')),
    adapter_message_id text,
    error_message text,
    latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    reported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE channel.dialog_states (
    channel_identity_id uuid PRIMARY KEY REFERENCES iam.channel_identities(id) ON DELETE CASCADE,
    flow_type text NOT NULL CHECK (flow_type IN ('JOIN', 'PROFILE', 'QUESTION', 'ACTIVITY')),
    step text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE channel.thread_refs (
    channel_identity_id uuid NOT NULL REFERENCES iam.channel_identities(id) ON DELETE CASCADE,
    thread_key text NOT NULL,
    external_message_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_identity_id, thread_key)
);

CREATE TABLE channel.tg_file_cache (
    blob_ref text PRIMARY KEY,
    file_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_outbox_polling
    ON channel.outbox (channel_type, status, priority, next_attempt_at, created_at);

CREATE INDEX idx_channel_outbox_identity ON channel.outbox (channel_identity_id, created_at DESC);
CREATE INDEX idx_channel_reports_outbox ON channel.delivery_reports (outbox_id, reported_at DESC);
