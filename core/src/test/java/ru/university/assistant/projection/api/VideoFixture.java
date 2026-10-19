package ru.university.assistant.projection.api;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/** Synthetic MP4 framing fixtures only, not a claim of decodable H264 samples. */
public final class VideoFixture {
    private VideoFixture() {}
    public static final String CODEC = "avc1.420028";

    public static byte[] init() {
        byte[] sample = new byte[78];
        ByteBuffer.wrap(sample).putShort(24, (short) 1920).putShort(26, (short) 1080);
        byte[] avc = box("avc1", join(sample, box("avcC", new byte[] {1, 0x42, 0, 0x28, -1, -31, 0})));
        byte[] stsd = box("stsd", join(ints(0, 1), avc));
        byte[] minf = box("minf", box("stbl", stsd));
        byte[] handler = box("hdlr", join(new byte[8], "vide".getBytes(StandardCharsets.US_ASCII)));
        byte[] track = box("trak", box("mdia", join(handler, minf)));
        byte[] movie = box("moov", join(box("mvhd", new byte[8]), track, box("mvex", box("trex", ints(0, 1)))));
        return join(box("ftyp", "iso60000iso6".getBytes(StandardCharsets.US_ASCII)), movie);
    }

    public static byte[] segment() { return segment(1); }

    public static byte[] segment(int payloadSize) {
        byte[] traf = box("traf", join(box("tfhd", ints(0x020000, 1)),
                box("tfdt", ints(0, 0)), box("trun", ints(0x301, 1, 0, 90000, payloadSize))));
        return join(box("moof", join(box("mfhd", ints(0, 1)), traf)), box("mdat", new byte[payloadSize]));
    }

    public static byte[] box(String type, byte[] payload) {
        return ByteBuffer.allocate(payload.length + 8).putInt(payload.length + 8)
                .put(type.getBytes(StandardCharsets.US_ASCII)).put(payload).array();
    }
    public static byte[] join(byte[]... arrays) {
        int size = 0;
        for (byte[] bytes : arrays) size += bytes.length;
        ByteBuffer result = ByteBuffer.allocate(size);
        for (byte[] bytes : arrays) result.put(bytes);
        return result.array();
    }
    private static byte[] ints(int... values) {
        ByteBuffer result = ByteBuffer.allocate(values.length * 4);
        for (int value : values) result.putInt(value);
        return result.array();
    }
}
