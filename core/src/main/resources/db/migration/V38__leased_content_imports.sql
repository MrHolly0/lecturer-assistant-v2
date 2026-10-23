alter table content.import_jobs
    add column available_at timestamptz not null default now(),
    add column worker_id uuid,
    add column claim_token uuid,
    add column lease_until timestamptz,
    add column attempts integer not null default 0;

-- A rolling upgrade must drain old workers first. Give an already running legacy
-- import a grace period; a second new core never fails another worker at startup.
update content.import_jobs set lease_until = now() + interval '15 minutes'
where status = 'RUNNING';

create index ix_content_import_claim on content.import_jobs(available_at, created_at, id) where status = 'PENDING';
create index ix_content_import_lease on content.import_jobs(lease_until) where status = 'RUNNING';
