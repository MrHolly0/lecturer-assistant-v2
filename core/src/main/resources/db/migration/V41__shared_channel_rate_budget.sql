-- One provider budget shared by adapter processes; no per-user cardinality.
create table channel.rate_budgets (
    channel_type varchar(32) primary key,
    next_slot_at timestamptz not null default now(),
    cooldown_until timestamptz not null default now()
);
