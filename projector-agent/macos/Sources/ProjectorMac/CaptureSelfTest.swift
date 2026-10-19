import AppKit
@preconcurrency import AVFoundation
import CoreImage

private final class SegmentCollector: NSObject, AVAssetWriterDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [(Data, Bool)] = []
    func assetWriter(_ writer: AVAssetWriter, didOutputSegmentData segmentData: Data, segmentType: AVAssetSegmentType, segmentReport: AVAssetSegmentReport?) {
        lock.lock(); stored.append((segmentData, segmentType == .initialization)); lock.unlock()
    }
    var segments: [(Data, Bool)] { lock.lock(); defer { lock.unlock() }; return stored }
}

@MainActor enum CaptureSelfTest {
    static func run() throws {
        let origin = URL(string: "https://school.example/")!
        let uuid = "12345678-1234-1234-1234-123456789abc"
        let token = uuid + "." + String(repeating: "a", count: 64)
        let scope = NativeCaptureScope(origin: origin, courseID: UUID(uuidString: uuid)!, sessionID: UUID(uuidString: uuid)!, token: token)
        guard scope.path == "/api/v1/courses/\(uuid)/sessions/\(uuid)/screen-share" else { throw HostError.code("SELF_TEST_SCOPED_PATH_CASE") }
        let remote = URL(string: "https://school.example/#/helper/remote?courseId=\(uuid)&sessionId=\(uuid)&controlToken=\(token)")!
        guard RemoteWindow.allowed(remote, origin: origin) else { throw HostError.code("SELF_TEST_REMOTE_URL") }
        guard RemoteWindow.matches(remote, courseID: UUID(uuidString: uuid)!, sessionID: UUID(uuidString: uuid)!, token: token),
              !RemoteWindow.matches(remote, courseID: UUID(), sessionID: UUID(uuidString: uuid)!, token: token),
              !RemoteWindow.matches(remote, courseID: UUID(uuidString: uuid)!, sessionID: UUID(uuidString: uuid)!, token: token + "0") else { throw HostError.code("SELF_TEST_REMOTE_SCOPE_MATCH") }
        for candidate in [remote.absoluteString.replacingOccurrences(of: "school.example", with: "other.example"), remote.absoluteString.replacingOccurrences(of: "https:", with: "http:"), remote.absoluteString + "&extra=true", remote.absoluteString.replacingOccurrences(of: "controlToken=", with: "token=")] {
            guard !RemoteWindow.allowed(URL(string: candidate)!, origin: origin) else { throw HostError.code("SELF_TEST_REMOTE_ORIGIN_GUARD") }
        }
        guard !RemoteWindow.validToken("staff.jwt.token"), !RemoteWindow.validToken(uuid + "." + String(repeating: "g", count: 64)) else { throw HostError.code("SELF_TEST_TOKEN_GUARD") }

        let collector = SegmentCollector()
        let parts = try CaptureWriter.make(width: 640, height: 360, delegate: collector)
        let writer = parts.0, input = parts.1, adaptor = parts.2
        guard writer.startWriting() else { print("Encoder diagnostic: " + String(describing: writer.error)); throw HostError.code("SELF_TEST_ENCODER_START") }
        writer.startSession(atSourceTime: .zero)
        let context = CIContext(options: [.cacheIntermediates: false])
        for index in 0..<75 {
            let deadline = Date().addingTimeInterval(5)
            while !input.isReadyForMoreMediaData, Date() < deadline, writer.status == .writing { RunLoop.current.run(until: Date().addingTimeInterval(0.005)) }
            guard input.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool else { throw HostError.code("SELF_TEST_ENCODER_BACKPRESSURE") }
            var buffer: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { throw HostError.code("SELF_TEST_PIXEL_BUFFER") }
            let image = CIImage(color: CIColor(red: Double(index % 15) / 15, green: 0.4, blue: 0.7)).cropped(to: CGRect(x: 0, y: 0, width: 640, height: 360))
            context.render(image, to: buffer)
            guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(index), timescale: 15)) else { throw HostError.code("SELF_TEST_ENCODER_APPEND") }
        }
        input.markAsFinished()
        writer.finishWriting { }
        let deadline = Date().addingTimeInterval(15)
        while writer.status == .writing, Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        guard writer.status == .completed else { throw HostError.code("SELF_TEST_ENCODER_FINISH") }
        let raw = collector.segments
        guard raw.filter({ $0.1 }).count == 1, raw.filter({ !$0.1 }).count >= 3 else { throw HostError.code("SELF_TEST_FRAGMENT_COUNT") }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("lecture-native-encoded-self-test", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var joined = Data(), mediaIndex = 0, codec = ""
        for (bytes, initialization) in raw {
            let normalized = try CaptureMp4.normalize(bytes, initialization: initialization)
            if initialization { codec = try CaptureMp4.codec(normalized); try normalized.write(to: folder.appendingPathComponent("init.mp4")) }
            else { try normalized.write(to: folder.appendingPathComponent("segment-\(mediaIndex).m4s")); mediaIndex += 1 }
            joined.append(normalized)
        }
        try joined.write(to: folder.appendingPathComponent("synthetic.mp4"))
        let asset = AVURLAsset(url: folder.appendingPathComponent("synthetic.mp4"))
        guard let track = asset.tracks(withMediaType: .video).first else { throw HostError.code("SELF_TEST_DECODE_TRACK") }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        reader.add(output); guard reader.startReading() else { throw HostError.code("SELF_TEST_DECODE_START") }
        var decoded = 0
        while let sample = output.copyNextSampleBuffer() { if sample.imageBuffer != nil { decoded += 1 } }
        guard reader.status == .completed, decoded == 75 else { throw HostError.code("SELF_TEST_DECODE_FRAMES") }
        print("PASS strict HTTPS remote scope/token/extra-param guards; real AVAssetWriter H264 \(codec), \(mediaIndex) bounded CMAF moof/mdat fragments; AVAssetReader decoded all \(decoded) synthetic frames; no screen capture, display change, keychain, login or network; fixtures \(folder.path)")
    }
}
