CREATE TABLE projection.release_checkpoints (
    platform varchar(24) NOT NULL,
    artifact_type varchar(16) NOT NULL CHECK (artifact_type IN ('UPDATE', 'INSTALLER')),
    sequence bigint NOT NULL,
    version varchar(32) NOT NULL,
    payload_hash varchar(64) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(platform, artifact_type)
);
