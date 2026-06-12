ALTER TABLE content.import_jobs
    DROP CONSTRAINT import_jobs_status_check;

ALTER TABLE content.import_jobs
    ADD CONSTRAINT import_jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'));

ALTER TABLE content.import_jobs
    ADD COLUMN phase text,
    ADD COLUMN processed_slides integer NOT NULL DEFAULT 0 CHECK (processed_slides >= 0),
    ADD COLUMN total_slides integer CHECK (total_slides IS NULL OR total_slides >= 0),
    ADD COLUMN warning_message text;
