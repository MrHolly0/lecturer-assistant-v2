package ru.university.assistant.shared.api;

/** Shared bounds for an ephemeral screen frame and its delivery as a chat file. */
public final class ScreenFrameLimits {
    public static final int MAX_BYTES = 2 * 1024 * 1024;
    public static final int MAX_DIMENSION = 3840;
    public static final long MAX_PIXELS = 3840L * 2160;

    private ScreenFrameLimits() {}
}
