package ru.university.assistant.iam.internal.security;

import java.security.MessageDigest;

final class MessageDigestSupport {
    private MessageDigestSupport() {}

    static boolean equals(byte[] expected, byte[] actual) {
        return MessageDigest.isEqual(expected, actual);
    }
}
