package ru.university.assistant.iam.internal;

import java.time.Instant;

record MaxInitData(
        long userId, String firstName, String lastName, String username, String startParam, Instant authDate) {}
