-- Run as table owner after provisioning the content_scaler LOGIN with a private password.
-- The scaler counts jobs; it cannot read course materials, students or job payloads.
GRANT CONNECT ON DATABASE lecturer TO content_scaler;
GRANT USAGE ON SCHEMA content TO content_scaler;
GRANT SELECT (status, available_at) ON content.import_jobs TO content_scaler;
ALTER ROLE content_scaler CONNECTION LIMIT 4;
ALTER ROLE content_scaler SET default_transaction_read_only = on;
ALTER ROLE content_scaler SET statement_timeout = '2s';
