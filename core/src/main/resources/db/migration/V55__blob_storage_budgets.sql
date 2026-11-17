CREATE TABLE content.storage_budget(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  initialized boolean NOT NULL DEFAULT false, bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0));
INSERT INTO content.storage_budget(singleton) VALUES(true);
CREATE TABLE content.course_storage_budget(course_id uuid PRIMARY KEY, bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0));
CREATE TABLE content.blob_usage(ref text PRIMARY KEY, course_id uuid, bytes bigint NOT NULL CHECK(bytes>=0),
  created_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='content_worker') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON content.storage_budget,content.course_storage_budget,content.blob_usage TO content_worker;
 END IF;
END $$;
