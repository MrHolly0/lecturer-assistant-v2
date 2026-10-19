import AppKit
@preconcurrency import ScreenCaptureKit
@preconcurrency import AVFoundation
import CoreImage
import UniformTypeIdentifiers

struct NativeCaptureScope: Sendable {
    let origin: URL
    let courseID: UUID
    let sessionID: UUID
    let token: String
    var path: String { "/api/v1/courses/\(courseID.uuidString.lowercased())/sessions/\(sessionID.uuidString.lowercased())/screen-share" }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
private struct CaptureHTTPError: Error { let status: Int }

/// Serial bounded upload queue; nothing is recorded to disk and no cookies are sent.
actor NativeMediaPublisher {
    private let scope: NativeCaptureScope
    private let client: URLSession
    private(set) var shareID: String?
    private var pending: [(String, Data, String)] = []
    private var pendingBytes = 0
    private var draining = false
    private var stopped = false
    private var suspended = false
    private var failure: (@Sendable (String) -> Void)?
    init(scope: NativeCaptureScope, failure: @escaping @Sendable (String) -> Void) {
        self.scope = scope; self.failure = failure
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false; config.httpCookieStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = 10; config.timeoutIntervalForResource = 15
        client = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    func start(name: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: ["sourceName": String(name.prefix(120))])
        let data = try await request(path: scope.path, method: "POST", body: body, contentType: "application/json")
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any], let id = json["id"] as? String, UUID(uuidString: id) != nil else { throw HostError.code("CAPTURE_START_INVALID_RESPONSE") }
        shareID = id; return id
    }
    func poll() async throws -> Bool {
        guard let id = shareID, !stopped else { return false }
        let data = try await request(path: scope.path + "/" + id, method: "GET")
        let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return value?["paused"] as? Bool ?? false
    }
    func enqueue(_ suffix: String, data: Data, contentType: String) async {
        guard !stopped, !suspended, shareID != nil else { return }
        guard pending.count < 12, pendingBytes + data.count <= 12 * 1024 * 1024 else { fail("CAPTURE_CONNECTION_TOO_SLOW"); return }
        // A fresh fallback frame replaces an unsent frame, without reordering video fragments.
        if suffix == "/frame", let index = pending.firstIndex(where: { $0.0 == "/frame" }) { pendingBytes -= pending[index].1.count; pending.remove(at: index) }
        pending.append((suffix, data, contentType)); pendingBytes += data.count
        guard !draining else { return }; draining = true
        while !pending.isEmpty, !stopped {
            let item = pending.removeFirst(); pendingBytes -= item.1.count
            do { _ = try await request(path: scope.path + "/" + shareID! + item.0, method: "PUT", body: item.1, contentType: item.2) }
            catch let error as CaptureHTTPError where error.status == 409 {
                // Pause can race one in-flight media request; heartbeat applies the new video epoch.
                suspended = true; pending.removeAll(); pendingBytes = 0; break
            }
            catch { fail("CAPTURE_UPLOAD_FAILED"); break }
        }
        draining = false
    }
    func stop() async {
        stopped = true; pending.removeAll(); pendingBytes = 0
        if let id = shareID { _ = try? await request(path: scope.path + "/" + id, method: "DELETE") }
        shareID = nil; client.invalidateAndCancel()
    }
    func suspend(_ value: Bool) { suspended = value; if value { pending.removeAll(); pendingBytes = 0 } }
    func needsVideoEpoch() -> Bool { suspended }
    private func fail(_ code: String) { stopped = true; pending.removeAll(); pendingBytes = 0; failure?(code) }
    private func request(path: String, method: String, body: Data? = nil, contentType: String? = nil) async throws -> Data {
        guard path.hasPrefix(scope.path), var url = URLComponents(url: scope.origin, resolvingAgainstBaseURL: false) else { throw HostError.code("CAPTURE_ORIGIN_REJECTED") }
        let pieces = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        url.path = String(pieces[0]); url.percentEncodedQuery = pieces.count == 2 ? String(pieces[1]) : nil
        guard let endpoint = url.url else { throw HostError.code("CAPTURE_ORIGIN_REJECTED") }
        var request = URLRequest(url: endpoint); request.httpMethod = method; request.httpBody = body
        request.setValue(scope.token, forHTTPHeaderField: "X-Lecture-Control-Token")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await client.data(for: request)
        guard let http = response as? HTTPURLResponse, data.count <= 1024 * 1024 else { throw HostError.code("CAPTURE_SERVER_REJECTED") }
        guard (200...299).contains(http.statusCode) else { throw CaptureHTTPError(status: http.statusCode) }
        return data
    }
}

/// Apple adds optional segment prefix boxes. Relay only bounded fMP4 boxes accepted by the media API.
enum CaptureMp4 {
    static func normalize(_ data: Data, initialization: Bool) throws -> Data {
        var offset = 0, selected = Data(), types: [String] = []
        while offset < data.count {
            guard data.count - offset >= 8 else { throw HostError.code("CAPTURE_MP4_INVALID") }
            let size = data[offset..<offset+4].reduce(0) { ($0 << 8) | Int($1) }
            guard size >= 8, size <= data.count - offset else { throw HostError.code("CAPTURE_MP4_INVALID") }
            let type = String(decoding: data[offset+4..<offset+8], as: UTF8.self)
            if (initialization ? ["ftyp", "moov"] : ["moof", "mdat"]).contains(type) { selected.append(data[offset..<offset+size]); types.append(type) }
            offset += size
        }
        guard types == (initialization ? ["ftyp", "moov"] : ["moof", "mdat"]), selected.count <= (initialization ? 128 * 1024 : 2 * 1024 * 1024) else { throw HostError.code("CAPTURE_MP4_INVALID") }
        return selected
    }
    static func codec(_ data: Data) throws -> String {
        let marker = Data("avcC".utf8)
        guard let index = data.range(of: marker)?.upperBound, data.count >= index + 4, data[index] == 1 else { throw HostError.code("CAPTURE_H264_CONFIG_MISSING") }
        return String(format: "avc1.%02x%02x%02x", data[index+1], data[index+2], data[index+3])
    }
}

@MainActor enum CaptureWriter {
    static func make(width: Int, height: Int, delegate: AVAssetWriterDelegate) throws -> (AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor) {
        let writer = AVAssetWriter(contentType: .mpeg4Movie)
        writer.outputFileTypeProfile = .mpeg4CMAFCompliant
        writer.preferredOutputSegmentInterval = CMTime(value: 1, timescale: 1)
        writer.initialSegmentStartTime = .zero; writer.delegate = delegate
        let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2_500_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel, AVVideoMaxKeyFrameIntervalKey: 15, AVVideoAllowFrameReorderingKey: false]]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings); input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw HostError.code("CAPTURE_H264_UNAVAILABLE") }; writer.add(input)
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
        return (writer, input, adaptor)
    }
}

private struct CapturedSample: @unchecked Sendable { let value: CMSampleBuffer }

@MainActor final class NativeCapture: NSObject, SCStreamOutput, SCStreamDelegate, AVAssetWriterDelegate {
    var event: (([String: Any]) -> Void)?
    var presentationWindow: (() -> NSWindow?)?
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var latestBuffer: CVPixelBuffer?
    private var frameTimer: Timer?
    private var startedAt = 0.0
    private var publisher: NativeMediaPublisher?
    private var currentScope: NativeCaptureScope?
    private var sourceName = ""
    private var dimensions = (width: 1920, height: 1080)
    private var epoch = UUID().uuidString
    private var sequence = 0
    private var generation = UUID()
    private var paused = false
    private var lastPreview = -Double.infinity
    private var lastFrame = -Double.infinity
    private var pollTimer: Timer?
    private var choosingSource = false
    private let selectionDialog = CaptureDialog()
    private let systemPicker = SystemSourcePicker()
    private let displayAuthorization = DisplayCaptureAuthorization()
    private var sourceKind = "window"
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let sampleQueue = DispatchQueue(label: "ru.university.lecturer.capture", qos: .userInitiated)
    var isActive: Bool { choosingSource || stream != nil || publisher != nil }

    func bind(_ scope: NativeCaptureScope) {
        if let previous = currentScope, previous.sessionID != scope.sessionID || previous.courseID != scope.courseID || previous.origin != scope.origin || previous.token != scope.token { Task { await stop() } }
        currentScope = scope
    }
    static var capabilities: [String: Any] {
        ["type": "capabilities", "platform": "MACOS", "nativeCapture": true,
         "captureExclusion": ["supported": true, "enabled": true],
         "captureModes": ["window": true, "application": true, "protectedDisplay": true],
         "displayPermissionRequired": !CGPreflightScreenCaptureAccess()]
    }
    func chooseSource(selection: (() async throws -> SCContentFilter?)? = nil) async {
        guard !choosingSource else { return }
        await stop(emitState: false)
        let selectionID = generation; choosingSource = true
        defer { if generation == selectionID { choosingSource = false } }
        event?(["type": "capture-state", "phase": "choosing", "permissionPending": false])
        do {
            let filter: SCContentFilter?
            if let selection { filter = try await selection() } else { filter = try await systemPicker.select() }
            guard generation == selectionID else { return }
            guard let filter else { systemPicker.deactivate(); status(); return }
            guard filter.style == .window || filter.style == .application else { throw HostError.code("CAPTURE_UNPROTECTED_DISPLAY_REJECTED") }
            let ownPID = ProcessInfo.processInfo.processIdentifier
            var name = filter.style == .application ? "Приложение" : "Окно"
            if #available(macOS 15.2, *) {
                guard !filter.includedApplications.contains(where: { $0.processID == ownPID || ["ru.university.lecturer-projector.host", "ru.university.lecturer-projector"].contains($0.bundleIdentifier) }),
                      !filter.includedWindows.contains(where: { $0.owningApplication?.processID == ownPID }) else { throw HostError.code("CAPTURE_PRIVATE_SOURCE_REJECTED") }
                if filter.style == .window { name = filter.includedWindows.first?.title ?? name }
                else { name = filter.includedApplications.first?.applicationName ?? name }
            }
            let scale = Double(filter.pointPixelScale), rect = filter.contentRect
            guard rect.width.isFinite, rect.height.isFinite, scale.isFinite, rect.width > 0, rect.height > 0, scale > 0,
                  Double(rect.width) * scale <= 100_000, Double(rect.height) * scale <= 100_000 else { throw HostError.code("CAPTURE_SOURCE_GONE") }
            sourceKind = filter.style == .application ? "application" : "window"
            try await startPreview(filter: filter, width: Int(Double(rect.width) * scale), height: Int(Double(rect.height) * scale), name: String(name.prefix(120)), selectionID: selectionID)
        } catch {
            guard generation == selectionID else { return }
            await stop(); emitError((error as? HostError).flatMap { if case .code(let code) = $0 { return code }; return nil } ?? "CAPTURE_SOURCE_FAILED")
        }
    }
    func chooseDisplay() async {
        guard !choosingSource else { return }
        await stop(emitState: false)
        let selection = generation; choosingSource = true
        defer { if generation == selection { choosingSource = false } }
        guard await authorizeScreenCapture(selection: selection), generation == selection else { return }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            guard generation == selection else { return }
            let ownApps = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier }
            guard !ownApps.isEmpty else { throw HostError.code("CAPTURE_PRIVATE_WINDOW_EXCLUSION_UNAVAILABLE") }
            let choices = content.displays.map { display -> (String, SCDisplay) in
                let matched = NSScreen.screens.firstIndex { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display.displayID }
                let label = matched.map { "Экран \($0 + 1) · " + NSScreen.screens[$0].localizedName } ?? "Дисплей без номера · \(display.width)×\(display.height)"
                return (String(label.prefix(120)), display)
            }
            guard !choices.isEmpty else { throw HostError.code("CAPTURE_NO_SOURCES") }
            let alert = NSAlert(); alert.messageText = "Какой экран показать?"
            alert.informativeText = "Пульт и окно проектора будут исключены из показа. Остальные окна выбранного экрана будут видны. Сначала проверьте предпросмотр."
            let select = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 460, height: 32)); choices.forEach { select.addItem(withTitle: $0.0) }; alert.accessoryView = select
            alert.addButton(withTitle: "Проверить кадр"); alert.addButton(withTitle: "Отмена")
            guard await presentSelectionAlert(alert) == .alertFirstButtonReturn, generation == selection else { status(); return }
            let choice = choices[select.indexOfSelectedItem]
            let filter = try Self.protectedDisplayFilter(display: choice.1, applications: ownApps)
            sourceKind = "display"
            try await startPreview(filter: filter, width: choice.1.width, height: choice.1.height, name: choice.0, selectionID: selection)
        } catch {
            guard generation == selection else { return }
            await stop(); emitError((error as? HostError).flatMap { if case .code(let code) = $0 { return code }; return nil } ?? "CAPTURE_SOURCE_FAILED")
        }
    }
    private func startPreview(filter: SCContentFilter, width: Int, height: Int, name: String, selectionID: UUID) async throws {
        guard width > 0, height > 0 else { throw HostError.code("CAPTURE_SOURCE_GONE") }
        let scale = min(1, min(1920.0 / Double(width), 1080.0 / Double(height)))
        dimensions = (max(2, Int(Double(width) * scale) / 2 * 2), max(2, Int(Double(height) * scale) / 2 * 2))
        let config = SCStreamConfiguration(); config.width = dimensions.width; config.height = dimensions.height
        config.minimumFrameInterval = CMTime(value: 1, timescale: 15); config.queueDepth = 4
        config.pixelFormat = kCVPixelFormatType_32BGRA; config.showsCursor = true; config.capturesAudio = false
        let active = SCStream(filter: filter, configuration: config, delegate: self)
        try active.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        self.stream = active; sourceName = name
        if sourceKind != "display" { SCContentSharingPicker.shared.setConfiguration(SystemSourcePicker.configuration(windowIDs: NSApp.windows.map(\.windowNumber)), for: active) }
        try await active.startCapture()
        guard generation == selectionID else { try? await active.stopCapture(); return }
        event?(["type": "capture-state", "phase": "preview", "sourceName": sourceName, "sourceKind": sourceKind,
                "captureExcludesRemote": true, "permissionPending": false, "previewOnly": true])
    }
    func beginOwnPreviewFixture(window: SCWindow, ownWindow: NSWindow) async throws {
        guard window.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier else { throw HostError.code("CAPTURE_FIXTURE_NOT_OWN_WINDOW") }
        guard Int(window.windowID) == ownWindow.windowNumber else { throw HostError.code("CAPTURE_FIXTURE_WINDOW_MISMATCH") }
        await stop(); sourceKind = "window"
        // currentProcess metadata can report zero geometry without global
        // consent. The fixture knows the size of its own verified NSWindow; the
        // authorized content filter remains unchanged, as does production validation.
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let width = ownWindow.frame.width * ownWindow.backingScaleFactor
        let height = ownWindow.frame.height * ownWindow.backingScaleFactor
        guard width.isFinite, height.isFinite, width > 0, height > 0, width <= 100_000, height <= 100_000 else { throw HostError.code("CAPTURE_FIXTURE_INVALID_GEOMETRY") }
        try await startPreview(filter: filter, width: Int(width), height: Int(height), name: "Own fixture", selectionID: generation)
    }
    static func protectedDisplayFilter(display: SCDisplay, applications: [SCRunningApplication]) throws -> SCContentFilter {
        let own = applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier }
        guard !own.isEmpty else { throw HostError.code("CAPTURE_PRIVATE_WINDOW_EXCLUSION_UNAVAILABLE") }
        return SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
    }
    private func authorizeScreenCapture(selection: UUID) async -> Bool {
        event?(["type": "capture-state", "phase": "permission", "permissionPending": true])
        let granted = await displayAuthorization.request(preflight: { CGPreflightScreenCaptureAccess() }, activate: { NSApp.activate(ignoringOtherApps: true) }, prompt: {
            await CaptureAuthorization.offMainPrompt { CGRequestScreenCaptureAccess() }
        })
        if granted { return true }
        guard generation == selection else { return false }
        emitError("SCREEN_RECORDING_PERMISSION_REQUIRED")
        return false
    }
    private func presentSelectionAlert(_ alert: NSAlert) async -> NSApplication.ModalResponse {
        guard let parent = presentationWindow?() else { emitError("CAPTURE_REMOTE_REQUIRED"); return .cancel }
        NSApp.activate(ignoringOtherApps: true)
        return await selectionDialog.present(alert, for: parent)
    }
    func startPublishing() async {
        guard stream != nil, publisher == nil, let scope = currentScope else { emitError("CAPTURE_SELECT_SOURCE_FIRST"); return }
        let current = generation
        do {
            let publisher = NativeMediaPublisher(scope: scope) { [weak self] code in Task { @MainActor in guard let self, self.generation == current else { return }; await self.stop(); self.emitError(code) } }
            self.publisher = publisher
            let id = try await publisher.start(name: sourceName)
            guard generation == current else { await publisher.stop(); return }
            try prepareWriter()
            pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in Task { @MainActor in
                guard let self, self.generation == current, let publisher = self.publisher else { return }
                do { let paused = try await publisher.poll(); await self.applyPaused(paused); self.event?(["type": "capture-state", "phase": paused ? "paused" : "live", "sourceName": self.sourceName]) }
                catch { await self.stop(); self.emitError("CAPTURE_LEASE_LOST") }
            } }
            event?(["type": "capture-state", "phase": "live", "shareId": id, "sourceName": sourceName, "captureExcludesRemote": true])
        } catch { await stop(); emitError("CAPTURE_START_FAILED") }
    }
    private func prepareWriter() throws {
        let parts = try CaptureWriter.make(width: dimensions.width, height: dimensions.height, delegate: self)
        self.writer = parts.0; writerInput = parts.1; adaptor = parts.2; epoch = UUID().uuidString; sequence = 0
        guard parts.0.startWriting() else { throw HostError.code("CAPTURE_ENCODER_START_FAILED") }
        parts.0.startSession(atSourceTime: .zero); startedAt = ProcessInfo.processInfo.systemUptime
        frameTimer?.invalidate()
        frameTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 15, repeats: true) { [weak self] _ in Task { @MainActor in self?.encodeFrame() } }
    }
    private var firstPTS: CMTime?
    func setPaused(_ value: Bool) async {
        guard publisher != nil else { return }
        // The remote already changed server state through its scoped API; this bridge only
        // synchronizes the local encoder. Heartbeat independently verifies the server state.
        await applyPaused(value)
    }
    private func applyPaused(_ value: Bool) async {
        let needsEpoch = await publisher?.needsVideoEpoch() ?? false
        let staleEpoch = !value && needsEpoch
        guard paused != value || staleEpoch else { return }; paused = value
        await publisher?.suspend(value)
        frameTimer?.invalidate(); frameTimer = nil; writerInput?.markAsFinished(); writer?.cancelWriting(); writerInput = nil; adaptor = nil; writer = nil; firstPTS = nil
        if !value { do { try prepareWriter() } catch { await stop(); emitError("CAPTURE_RESUME_FAILED") } }
    }
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        let sample = CapturedSample(value: sampleBuffer)
        Task { @MainActor [weak self] in guard let self, self.stream === stream else { return }; self.consume(sample.value) }
    }
    private func consume(_ sample: CMSampleBuffer) {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let value = attachments.first?[.status] as? Int, value == SCFrameStatus.complete.rawValue else { return }
        guard let buffer = sample.imageBuffer else { return }
        // Keep the approved preview frame: SCK can stay idle on static code/slides,
        // so publishing must not wait for a new screen change after confirmation.
        latestBuffer = buffer
        let now = ProcessInfo.processInfo.systemUptime
        if publisher == nil {
            if now - lastPreview > 0.5, let jpeg = jpeg(buffer, quality: 0.65) { lastPreview = now; event?(["type": "preview", "phase": "preview", "frameUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "sourceName": sourceName, "captureExcludesRemote": true]) }
            return
        }
    }
    private func encodeFrame() {
        guard !paused, let buffer = latestBuffer, let publisher else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if let writer, let input = writerInput, let adaptor, input.isReadyForMoreMediaData {
            let time = CMTime(seconds: now - startedAt, preferredTimescale: 600)
            if !adaptor.append(buffer, withPresentationTime: time) { emitError("CAPTURE_ENCODER_FAILED"); Task { await stop() }; return }
            if writer.status == .failed { emitError("CAPTURE_ENCODER_FAILED"); Task { await stop() }; return }
        }
        if now - lastFrame > 1.5, let jpeg = jpeg(buffer, quality: 0.65), jpeg.count <= 256 * 1024 {
            lastFrame = now; Task { await publisher.enqueue("/frame", data: jpeg, contentType: "image/jpeg") }
        }
    }
    private func jpeg(_ buffer: CVPixelBuffer, quality: Double) -> Data? {
        let image = CIImage(cvPixelBuffer: buffer)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        for q in [quality, 0.4, 0.2] { if let data = imageContext.jpegRepresentation(of: image, colorSpace: space, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: q]), data.count <= 256 * 1024 { return data } }
        return nil
    }
    nonisolated func assetWriter(_ writer: AVAssetWriter, didOutputSegmentData segmentData: Data, segmentType: AVAssetSegmentType, segmentReport: AVAssetSegmentReport?) {
        let identity = ObjectIdentifier(writer)
        Task { @MainActor [weak self] in
            guard let self, let currentWriter = self.writer, ObjectIdentifier(currentWriter) == identity, let publisher = self.publisher else { return }
            do {
                let initialization = segmentType == .initialization
                let data = try CaptureMp4.normalize(segmentData, initialization: initialization)
                let suffix: String
                if initialization { suffix = "/video/\(self.epoch)/init?codec=" + (try CaptureMp4.codec(data)) }
                else { suffix = "/video/\(self.epoch)/segments/\(self.sequence)"; self.sequence += 1 }
                await publisher.enqueue(suffix, data: data, contentType: "video/mp4")
            } catch { await self.stop(); self.emitError("CAPTURE_MP4_FAILED") }
        }
    }
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor [weak self] in guard let self, self.stream === stream else { return }; await self.stop(); self.emitError("CAPTURE_SOURCE_STOPPED") }
    }
    func stop(emitState: Bool = true) async {
        generation = UUID(); choosingSource = false; pollTimer?.invalidate(); pollTimer = nil
        selectionDialog.cancel()
        let active = stream; stream = nil; latestBuffer = nil
        systemPicker.deactivate()
        frameTimer?.invalidate(); frameTimer = nil; writerInput?.markAsFinished(); writer?.cancelWriting(); writerInput = nil; adaptor = nil; writer = nil; firstPTS = nil
        let previous = publisher; publisher = nil; paused = false
        if emitState { event?(["type": "capture-state", "phase": "idle"]) }
        try? await active?.stopCapture(); await previous?.stop()
    }
    func status() { event?(["type": "capture-state", "phase": publisher == nil ? (stream == nil ? "idle" : "preview") : (paused ? "paused" : "live"), "sourceName": sourceName, "captureExcludesRemote": true]) }
    private func emitError(_ code: String) {
        let message: String
        switch code {
        case "SCREEN_RECORDING_PERMISSION_REQUIRED": message = "Для всего экрана требуется отдельное разрешение macOS. Можно продолжить через «Окно или приложение» без изменения настроек. Если доступ уже выдан, сохраните диагностику — повторно переключать его не нужно."
        case "CAPTURE_PRIVATE_WINDOW_EXCLUSION_UNAVAILABLE", "CAPTURE_PRIVATE_SOURCE_REJECTED", "CAPTURE_UNPROTECTED_DISPLAY_REJECTED": message = "Этот источник нельзя показать, сохранив пульт приватным. Выберите отдельное учебное окно или приложение. Пульт не будет опубликован."
        case "CAPTURE_SELECT_SOURCE_FIRST": message = "Сначала выберите окно или экран и проверьте предпросмотр."
        case "CAPTURE_CONNECTION_TOO_SLOW", "CAPTURE_UPLOAD_FAILED", "CAPTURE_LEASE_LOST": message = "Демонстрация остановлена: нет устойчивой связи с сервером. Проверьте подключение и запустите показ заново."
        case "CAPTURE_SOURCE_STOPPED", "CAPTURE_SOURCE_FAILED": message = "Источник больше недоступен или macOS не разрешила запись. Выберите окно или экран заново."
        case "CAPTURE_PAUSE_FAILED": message = "Не удалось изменить паузу. Проверьте состояние занятия на сайте."
        default: message = "Не удалось продолжить демонстрацию. Выберите источник заново. Код: " + code
        }
        event?(["type": "error", "code": code, "message": message, "permissionPending": false])
    }
}
