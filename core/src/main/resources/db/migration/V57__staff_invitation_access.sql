ALTER TABLE iam.invitations
    ADD COLUMN organization_unit_role varchar(16) NOT NULL DEFAULT 'MEMBER'
        CHECK (organization_unit_role IN ('MEMBER', 'MANAGER'));
