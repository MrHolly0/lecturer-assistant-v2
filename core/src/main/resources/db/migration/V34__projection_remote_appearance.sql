ALTER TABLE projection.devices ADD COLUMN remote_theme text
    CONSTRAINT devices_remote_theme_check CHECK (remote_theme IN ('light', 'dark'));
