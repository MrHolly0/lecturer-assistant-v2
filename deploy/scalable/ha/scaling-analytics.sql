-- Run as table owner after provisioning the analytics_scaler LOGIN with a private password.
GRANT CONNECT ON DATABASE analytics TO analytics_scaler;
GRANT USAGE ON SCHEMA public TO analytics_scaler;
GRANT SELECT (dead, next_attempt_at, lease_until) ON report_jobs TO analytics_scaler;
ALTER ROLE analytics_scaler CONNECTION LIMIT 4;
ALTER ROLE analytics_scaler SET default_transaction_read_only = on;
ALTER ROLE analytics_scaler SET statement_timeout = '2s';
