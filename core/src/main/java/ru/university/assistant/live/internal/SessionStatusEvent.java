package ru.university.assistant.live.internal;

import java.time.Instant;

record SessionStatusEvent(String verb, Instant occurredAt) {}
