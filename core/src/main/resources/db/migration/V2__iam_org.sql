CREATE TABLE iam.persons (
    id uuid PRIMARY KEY,
    display_name text NOT NULL,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('ADMIN', 'LECTURER', 'ASSISTANT', 'STUDENT')),
    status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED', 'EPHEMERAL')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org.courses (
    id uuid PRIMARY KEY,
    owner_person_id uuid NOT NULL REFERENCES iam.persons(id),
    title text NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org.course_members (
    course_id uuid NOT NULL REFERENCES org.courses(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('LECTURER', 'ASSISTANT', 'STUDENT')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, person_id)
);

CREATE TABLE org.study_groups (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES org.courses(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, name)
);

CREATE TABLE org.group_members (
    group_id uuid NOT NULL REFERENCES org.study_groups(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, person_id)
);

CREATE TABLE iam.invitations (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE,
    role text NOT NULL CHECK (role IN ('ADMIN', 'LECTURER', 'ASSISTANT', 'STUDENT')),
    course_id uuid REFERENCES org.courses(id) ON DELETE CASCADE,
    group_id uuid REFERENCES org.study_groups(id) ON DELETE CASCADE,
    created_by uuid REFERENCES iam.persons(id),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.refresh_tokens (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.identity_link_codes (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.channel_identities (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    channel_type text NOT NULL CHECK (channel_type IN ('telegram', 'vk', 'web')),
    external_id text NOT NULL,
    display_hint text,
    linked_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (channel_type, external_id)
);

CREATE TABLE iam.course_bans (
    course_id uuid NOT NULL REFERENCES org.courses(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    reason text,
    banned_by uuid NOT NULL REFERENCES iam.persons(id),
    banned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, person_id)
);

CREATE INDEX idx_persons_role ON iam.persons(role);
CREATE INDEX idx_invitations_code ON iam.invitations(code);
CREATE INDEX idx_course_members_person ON org.course_members(person_id);
CREATE INDEX idx_group_members_person ON org.group_members(person_id);
