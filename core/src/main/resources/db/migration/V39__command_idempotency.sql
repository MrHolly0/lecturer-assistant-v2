create table shared.command_idempotency (
    actor_id uuid not null references iam.persons(id) on delete cascade,
    operation text not null,
    key_hash char(64) not null,
    request_hash char(64) not null,
    response_json jsonb,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '24 hours',
    primary key (actor_id, operation, key_hash)
);
create index ix_command_idempotency_expiry on shared.command_idempotency(expires_at);
