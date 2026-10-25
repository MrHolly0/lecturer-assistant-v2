-- Preserve the slide the student was asking about, independently of later navigation.
-- Historical questions remain unknown; the current slide cannot reconstruct their origin.
ALTER TABLE qa.questions ADD COLUMN slide_idx integer CHECK (slide_idx > 0);
