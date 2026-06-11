CREATE TABLE content.import_jobs (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES org.courses(id) ON DELETE CASCADE,
    deck_id uuid,
    status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
    source_file_ref text NOT NULL,
    source_filename text NOT NULL,
    source_content_type text NOT NULL,
    source_size_bytes bigint NOT NULL CHECK (source_size_bytes >= 0),
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.slide_decks (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES org.courses(id) ON DELETE CASCADE,
    title text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    source_file_ref text NOT NULL,
    source_filename text NOT NULL,
    source_content_type text NOT NULL,
    source_size_bytes bigint NOT NULL CHECK (source_size_bytes >= 0),
    import_job_id uuid REFERENCES content.import_jobs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, title, version)
);

ALTER TABLE content.import_jobs
    ADD CONSTRAINT fk_import_jobs_deck
    FOREIGN KEY (deck_id) REFERENCES content.slide_decks(id) ON DELETE SET NULL;

CREATE TABLE content.slides (
    id uuid PRIMARY KEY,
    deck_id uuid NOT NULL REFERENCES content.slide_decks(id) ON DELETE CASCADE,
    idx integer NOT NULL CHECK (idx >= 0),
    image_ref text NOT NULL,
    text_extract text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deck_id, idx)
);

CREATE TABLE content.slide_notes (
    slide_id uuid PRIMARY KEY REFERENCES content.slides(id) ON DELETE CASCADE,
    text text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live.lectures (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES org.courses(id) ON DELETE CASCADE,
    title text NOT NULL,
    deck_id uuid NOT NULL REFERENCES content.slide_decks(id),
    default_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    archived boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES iam.persons(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.attachments (
    id uuid PRIMARY KEY,
    lecture_id uuid NOT NULL REFERENCES live.lectures(id) ON DELETE CASCADE,
    file_ref text NOT NULL,
    filename text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_jobs_course ON content.import_jobs(course_id, created_at DESC);
CREATE INDEX idx_slide_decks_course ON content.slide_decks(course_id, created_at DESC);
CREATE INDEX idx_slides_deck_idx ON content.slides(deck_id, idx);
CREATE INDEX idx_lectures_course ON live.lectures(course_id, archived, created_at DESC);
CREATE INDEX idx_attachments_lecture ON content.attachments(lecture_id, created_at DESC);
