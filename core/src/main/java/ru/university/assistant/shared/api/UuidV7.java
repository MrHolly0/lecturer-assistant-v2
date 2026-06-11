package ru.university.assistant.shared.api;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.UUID;

public final class UuidV7 {
    private static final SecureRandom RANDOM = new SecureRandom();

    private UuidV7() {}

    public static UUID generate() {
        byte[] random = new byte[10];
        RANDOM.nextBytes(random);

        long timestamp = Instant.now().toEpochMilli();
        long mostSignificantBits = (timestamp & 0x0000_ffff_ffff_ffffL) << 16;
        mostSignificantBits |= 0x7000L;
        mostSignificantBits |= Byte.toUnsignedLong(random[0]) << 8;
        mostSignificantBits |= Byte.toUnsignedLong(random[1]);

        long leastSignificantBits = 0x8000_0000_0000_0000L | ((Byte.toUnsignedLong(random[2]) & 0x3fL) << 56);
        for (int index = 3; index < random.length; index++) {
            leastSignificantBits |= Byte.toUnsignedLong(random[index]) << ((random.length - 1 - index) * 8);
        }

        return new UUID(mostSignificantBits, leastSignificantBits);
    }
}
