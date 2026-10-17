CREATE TABLE org.units (
    id uuid PRIMARY KEY,
    parent_id uuid REFERENCES org.units(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    kind text NOT NULL CHECK (kind IN ('FACULTY', 'DEPARTMENT')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'FACULTY' AND parent_id IS NULL) OR (kind = 'DEPARTMENT' AND parent_id IS NOT NULL)),
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX units_sibling_name ON org.units
    (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX units_parent_idx ON org.units(parent_id);

CREATE TABLE org.staff_memberships (
    person_id uuid PRIMARY KEY REFERENCES iam.persons(id) ON DELETE CASCADE,
    unit_id uuid NOT NULL REFERENCES org.units(id) ON DELETE CASCADE,
    unit_role text NOT NULL CHECK (unit_role IN ('MEMBER', 'MANAGER')),
    assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_memberships_unit_idx ON org.staff_memberships(unit_id);
