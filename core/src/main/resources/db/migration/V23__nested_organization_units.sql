ALTER TABLE org.units DROP CONSTRAINT IF EXISTS units_kind_check;
ALTER TABLE org.units DROP CONSTRAINT IF EXISTS units_check;

ALTER TABLE org.units
    ADD CONSTRAINT units_kind_check CHECK (kind IN ('UNIT', 'FACULTY', 'DEPARTMENT'));

ALTER TABLE iam.invitations
    ADD COLUMN organization_unit_id uuid REFERENCES org.units(id) ON DELETE SET NULL;
