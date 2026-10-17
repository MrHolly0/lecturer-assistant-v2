alter table content.import_jobs
    add column import_title text not null default '',
    add column retry_of_job_id uuid references content.import_jobs(id) on delete set null;

create unique index uq_content_import_active_retry
    on content.import_jobs (retry_of_job_id)
    where retry_of_job_id is not null and status in ('PENDING', 'RUNNING');
