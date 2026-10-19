package ru.university.assistant.projection.api;

import java.util.UUID;

/** Each retained fragment begins at a publisher keyframe; metadata never registers a viewer. */
public record ShareVideoMetadata(UUID shareId, UUID epoch, String codec, long firstSequence, long lastSequence) {}
