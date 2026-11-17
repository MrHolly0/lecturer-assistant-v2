CREATE INDEX ix_refresh_expiry_cleanup ON iam.refresh_tokens(expires_at, id);
CREATE INDEX ix_refresh_revoked_cleanup ON iam.refresh_tokens(revoked_at, id) WHERE revoked_at IS NOT NULL;
CREATE INDEX ix_sfu_grant_capacity ON projection.sfu_grants(expires_at, room_id) INCLUDE (publisher);
