package ru.university.assistant.projection.internal;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.projection.capacity")
class ShareCapacityProperties {
    private int rooms = 64;
    private int viewersPerRoom = 200;
    private long frameBytes = 32 * 1024 * 1024L;
    private long videoBytes = 64 * 1024 * 1024L;
    private int videoRoomBytes = 8 * 1024 * 1024;
    public int getRooms() { return rooms; }
    public void setRooms(int value) { rooms = bounded(value, 1, 1000); }
    public int getViewersPerRoom() { return viewersPerRoom; }
    public void setViewersPerRoom(int value) { viewersPerRoom = bounded(value, 1, 2000); }
    public long getFrameBytes() { return frameBytes; }
    public void setFrameBytes(long value) { frameBytes = bounded(value, 2 * 1024 * 1024, 512 * 1024 * 1024); }
    public long getVideoBytes() { return videoBytes; }
    public void setVideoBytes(long value) { videoBytes = bounded(value, 2 * 1024 * 1024, 1024 * 1024 * 1024); }
    public int getVideoRoomBytes() { return videoRoomBytes; }
    public void setVideoRoomBytes(int value) {
        videoRoomBytes = bounded(value, 2 * 1024 * 1024 + 128 * 1024, 64 * 1024 * 1024);
    }
    private static int bounded(int value, int minimum, int maximum) {
        if (value < minimum || value > maximum) throw new IllegalArgumentException("Invalid projection capacity");
        return value;
    }
    private static long bounded(long value, long minimum, long maximum) {
        if (value < minimum || value > maximum) throw new IllegalArgumentException("Invalid projection capacity");
        return value;
    }
}
