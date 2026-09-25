package ru.university.assistant.content.internal;

import java.util.UUID;

record EditableSlideRecord(
        UUID id,
        int index,
        String imageRef,
        String textExtract,
        String noteText) {}
