package ru.university.assistant.projection.internal;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Narrow, bounded single-video-track fragmented MP4 framing checks; never decodes media. */
final class ShareVideoMp4 {
    private ShareVideoMp4() {}

    static String init(byte[] bytes, String codec) {
        if (codec == null || !codec.matches("(?i)avc1\\.[a-f0-9]{6}")) throw invalid();
        List<Box> top = boxes(bytes, 0, bytes.length);
        if (top.size() != 2 || !top.get(0).type().equals("ftyp") || !top.get(1).type().equals("moov")
                || top.get(0).size() < top.get(0).header() + 8) throw invalid();
        Box moov = top.get(1);
        List<Box> movie = children(bytes, moov, 0);
        required(movie, "mvhd"); required(movie, "mvex");
        List<Box> tracks = movie.stream().filter(box -> box.type().equals("trak")).toList();
        if (tracks.size() != 1) throw invalid();
        Box media = required(children(bytes, tracks.getFirst(), 0), "mdia");
        List<Box> mdia = children(bytes, media, 0);
        Box handler = required(mdia, "hdlr");
        if (handler.size() < handler.header() + 12
                || !text(bytes, handler.payload() + 8).equals("vide")) throw invalid();
        Box minf = required(mdia, "minf");
        Box stbl = required(children(bytes, minf, 0), "stbl");
        Box stsd = required(children(bytes, stbl, 0), "stsd");
        if (stsd.size() < stsd.header() + 8 || number(bytes, stsd.payload() + 4) != 1) throw invalid();
        List<Box> entries = children(bytes, stsd, 8);
        if (entries.size() != 1 || !entries.getFirst().type().equals("avc1")) throw invalid();
        Box avc = entries.getFirst();
        if (avc.size() < avc.header() + 78) throw invalid();
        int width = unsignedShort(bytes, avc.payload() + 24), height = unsignedShort(bytes, avc.payload() + 26);
        if (width < 1 || height < 1 || width > 4096 || height > 2160) throw invalid();
        Box config = required(children(bytes, avc, 78), "avcC");
        if (config.size() < config.header() + 7 || bytes[config.payload()] != 1) throw invalid();
        String actual = String.format(Locale.ROOT, "avc1.%02x%02x%02x", bytes[config.payload() + 1] & 255,
                bytes[config.payload() + 2] & 255, bytes[config.payload() + 3] & 255);
        // Encoders may add constrained-profile compatibility flags to the requested baseline profile.
        // Publish the exact avcC value; the profile and level still must match the negotiated encoder.
        if (!actual.substring(5, 7).equalsIgnoreCase(codec.substring(5, 7))
                || !actual.substring(9, 11).equalsIgnoreCase(codec.substring(9, 11))) throw invalid();
        return actual;
    }

    static void segment(byte[] bytes) {
        List<Box> top = boxes(bytes, 0, bytes.length);
        if (top.size() != 2 || !top.get(0).type().equals("moof") || !top.get(1).type().equals("mdat")
                || top.get(1).size() <= top.get(1).header()) throw invalid();
        List<Box> fragment = children(bytes, top.getFirst(), 0);
        Box mfhd = required(fragment, "mfhd");
        if (mfhd.size() != mfhd.header() + 8 || number(bytes, mfhd.payload()) != 0) throw invalid();
        List<Box> tracks = fragment.stream().filter(box -> box.type().equals("traf")).toList();
        if (tracks.size() != 1) throw invalid();
        List<Box> traf = children(bytes, tracks.getFirst(), 0);
        Box header = required(traf, "tfhd");
        if (header.size() < header.header() + 8 || bytes[header.payload()] != 0) throw invalid();
        long headerFlags = number(bytes, header.payload()) & 0xffffff;
        if ((headerFlags & ~0x03003bL) != 0 || number(bytes, header.payload() + 4) == 0) throw invalid();
        int headerFields = ((headerFlags & 1) != 0 ? 8 : 0) + Long.bitCount(headerFlags & 0x3a) * 4;
        if (header.size() != header.header() + 8 + headerFields) throw invalid();
        Box decodeTime = required(traf, "tfdt");
        if (decodeTime.size() < decodeTime.header() + 8) throw invalid();
        int version = bytes[decodeTime.payload()] & 255;
        if ((version != 0 && version != 1) || decodeTime.size() != decodeTime.header() + (version == 0 ? 8 : 12)) {
            throw invalid();
        }
        List<Box> runs = traf.stream().filter(box -> box.type().equals("trun")).toList();
        if (runs.isEmpty()) throw invalid();
        for (Box run : runs) validateRun(bytes, run);
    }

    private static void validateRun(byte[] bytes, Box run) {
        if (run.size() < run.header() + 8) throw invalid();
        long flags = number(bytes, run.payload()) & 0xffffff;
        int version = bytes[run.payload()] & 255;
        if (version > 1 || (flags & ~0xf05L) != 0) throw invalid();
        long count = number(bytes, run.payload() + 4);
        if (count < 1 || count > 4096) throw invalid();
        int optional = ((flags & 1) != 0 ? 4 : 0) + ((flags & 4) != 0 ? 4 : 0);
        int perSample = Long.bitCount(flags & 0xf00) * 4;
        if (run.size() != run.header() + 8L + optional + count * perSample) throw invalid();
    }

    private static List<Box> children(byte[] bytes, Box box, int prefix) {
        if (box.payload() + prefix > box.end()) throw invalid();
        return boxes(bytes, box.payload() + prefix, box.end());
    }

    private static Box required(List<Box> boxes, String type) {
        List<Box> matching = boxes.stream().filter(box -> box.type().equals(type)).toList();
        if (matching.size() != 1) throw invalid();
        return matching.getFirst();
    }

    private static List<Box> boxes(byte[] bytes, int start, int end) {
        List<Box> result = new ArrayList<>();
        for (int offset = start; offset < end;) {
            if (end - offset < 8 || result.size() >= 256) throw invalid();
            long length = number(bytes, offset);
            int header = 8;
            if (length == 1) {
                if (end - offset < 16) throw invalid();
                length = ByteBuffer.wrap(bytes, offset + 8, 8).getLong(); header = 16;
            }
            if (length < header || length > end - offset) throw invalid();
            int size = (int) length;
            result.add(new Box(text(bytes, offset + 4), offset + header, offset + size, header));
            offset += size;
        }
        return result;
    }

    private static long number(byte[] bytes, int offset) {
        return Integer.toUnsignedLong(ByteBuffer.wrap(bytes, offset, 4).getInt());
    }
    private static int unsignedShort(byte[] bytes, int offset) {
        return Short.toUnsignedInt(ByteBuffer.wrap(bytes, offset, 2).getShort());
    }
    private static String text(byte[] bytes, int offset) {
        return new String(bytes, offset, 4, StandardCharsets.US_ASCII);
    }
    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Требуется корректный H264/fMP4 сегмент");
    }
    private record Box(String type, int payload, int end, int header) {
        int size() { return end - payload + header; }
    }
}
