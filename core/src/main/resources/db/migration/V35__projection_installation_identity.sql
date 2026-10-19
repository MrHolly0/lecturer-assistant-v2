ALTER TABLE projection.devices ADD COLUMN installation_id uuid;
ALTER TABLE projection.devices ADD CONSTRAINT devices_owner_installation_unique
    UNIQUE (owner_id, installation_id);
