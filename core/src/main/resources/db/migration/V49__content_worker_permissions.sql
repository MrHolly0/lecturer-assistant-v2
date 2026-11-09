-- Installations without a separate worker role keep their existing configuration.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'content_worker') THEN
        GRANT USAGE ON SCHEMA content TO content_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON content.import_jobs, content.slide_decks, content.slides
            TO content_worker;
    END IF;
END $$;
