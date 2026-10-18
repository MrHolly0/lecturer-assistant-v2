ALTER TABLE org.units
    ADD COLUMN icon text NOT NULL DEFAULT 'FOLDER';

ALTER TABLE org.units
    ADD CONSTRAINT units_icon_check
    CHECK (icon IN (
        'FOLDER', 'USERS', 'GRADUATION', 'BOOK', 'BUILDING', 'BRIEFCASE',
        'FLASK', 'LAPTOP', 'PALETTE', 'GLOBE', 'LIBRARY', 'SCHOOL'
    ));
