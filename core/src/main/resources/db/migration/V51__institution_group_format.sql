CREATE TABLE org.group_format_policy (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT false,
    fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO org.group_format_policy(singleton) VALUES (true);

ALTER TABLE org.study_groups ADD COLUMN cohort_key varchar(64),
    ADD COLUMN cohort_parts jsonb,
    ADD COLUMN format_revision bigint;
CREATE INDEX ix_study_group_cohort ON org.study_groups(cohort_key) WHERE cohort_key IS NOT NULL;
