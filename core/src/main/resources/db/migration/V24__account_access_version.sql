ALTER TABLE iam.persons ADD COLUMN auth_version bigint NOT NULL DEFAULT 0;
ALTER TABLE live.web_participant_tokens ADD COLUMN auth_version bigint NOT NULL DEFAULT 0;

