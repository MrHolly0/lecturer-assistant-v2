CREATE TABLE projection.sfu_rooms (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    course_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    owner_version bigint NOT NULL,
    source_name varchar(120) NOT NULL,
    lease_until timestamptz NOT NULL,
    stopped boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sfu_one_room ON projection.sfu_rooms(session_id) WHERE NOT stopped;
CREATE TABLE projection.sfu_grants (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL REFERENCES projection.sfu_rooms(id) ON DELETE CASCADE,
    person_id uuid NOT NULL,
    auth_version bigint NOT NULL,
    viewer_id uuid NOT NULL,
    publisher boolean NOT NULL,
    projector boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL,
    UNIQUE(room_id, person_id, viewer_id, publisher, projector)
);
CREATE INDEX sfu_grant_expiry ON projection.sfu_grants(expires_at);
