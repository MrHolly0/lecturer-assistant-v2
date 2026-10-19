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
    private var usesSystemPickerGrant = false
    private var selectionRequestID: String?
    private var captureMode = "system-window"
    private var capturePhase = "idle"
    private var capturePermissionPending = false
    private var captureError: (code: String, message: String)?
    private var selectionScope: (courseID: UUID, sessionID: UUID)?
    private struct PendingSourceChoice {
        let generation: UUID
        let requestID: String
        let mode: String
        let scope: (courseID: UUID, sessionID: UUID)?
    }
    private var pendingSourceChoice: PendingSourceChoice?
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let sampleQueue = DispatchQueue(label: "ru.university.lecturer.capture", qos: .userInitiated)
    var isActive: Bool { pendingSourceChoice != nil || choosingSource || stream != nil || publisher != nil }

    func bind(_ scope: NativeCaptureScope) {
        if let previous = currentScope, previous.sessionID != scope.sessionID || previous.courseID != scope.courseID || previous.origin != scope.origin || previous.token != scope.token { Task { await stop() } }
        currentScope = scope
    }
    static var capabilities: [String: Any] {
        ["type": "capabilities", "platform": "MACOS", "nativeCapture": true,
         "captureExclusion": ["supported": true, "enabled": true],
         "captureModes": ["window": true, "application": true, "protectedDisplay": true, "manualWindow": true],
         "displayPermissionRequired": !CGPreflightScreenCaptureAccess()]
    }
    private func beginSourceChoice(requestID: String?, mode: String, teardownPause: (() async -> Void)? = nil) async -> UUID? {
        let request = UUID()
        let sourceRequestID = UUID(uuidString: requestID ?? "")?.uuidString.lowercased() ?? UUID().uuidString.lowercased()
        let scope = currentScope.map { (courseID: $0.courseID, sessionID: $0.sessionID) }
        pendingSourceChoice = PendingSourceChoice(generation: request, requestID: sourceRequestID, mode: mode, scope: scope)
        selectionRequestID = sourceRequestID
        captureMode = mode; sourceName = ""; sourceKind = mode == "display" ? "display" : "window"
        await stop(emitState: false, replacementGeneration: request, teardownPause: teardownPause)
        guard generation == request else { return nil }
        pendingSourceChoice = nil; selectionScope = scope
        choosingSource = true
        return request
    }
    func chooseSource(requestID: String? = nil, replacementTeardown: (() async -> Void)? = nil, selection: (() async throws -> SCContentFilter?)? = nil) async {
        guard let selectionID = await beginSourceChoice(requestID: requestID, mode: "system-window", teardownPause: replacementTeardown) else { return }
        defer { if generation == selectionID { choosingSource = false } }
        emit(["type": "capture-state", "phase": "choosing", "permissionPending": false])
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
            usesSystemPickerGrant = true
            try await startPreview(filter: filter, width: Int(Double(rect.width) * scale), height: Int(Double(rect.height) * scale), name: String(name.prefix(120)), selectionID: selectionID)
        } catch {
            guard generation == selectionID else { return }
            await fail((error as? HostError).flatMap { if case .code(let code) = $0 { return code }; return nil } ?? "CAPTURE_SOURCE_FAILED", expected: selectionID)
        }
    }
    func chooseDisplay(requestID: String? = nil) async {
        guard let selection = await beginSourceChoice(requestID: requestID, mode: "display") else { return }
        defer { if generation == selection { choosingSource = false } }
        guard await authorizeScreenCapture(selection: selection), generation == selection else { return }
        emit(["type": "capture-state", "phase": "choosing", "permissionPending": false, "sourceKind": "display"])
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
            let select = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 460, height: 32))
            let labels = Self.uniqueMenuLabels(choices.map(\.0))
            select.menu = try Self.sourceMenu(labels: labels, sourceIDs: choices.map { $0.1.displayID })
            select.selectItem(at: 0)
            alert.accessoryView = select
            alert.addButton(withTitle: "Проверить кадр"); alert.addButton(withTitle: "Отмена")
            let response = await presentSelectionAlert(alert)
            guard generation == selection else { return }
            guard response == .alertFirstButtonReturn else { status(); return }
            let selectedID = (select.selectedItem?.representedObject as? NSNumber)?.uint32Value
            guard let selectedIndex = Self.menuChoiceIndex(selectedID: selectedID, sourceIDs: choices.map { $0.1.displayID }) else {
                throw HostError.code("CAPTURE_SOURCE_SELECTION_INVALID")
            }
            let choice = choices[selectedIndex]
            let filter = try Self.protectedDisplayFilter(display: choice.1, applications: ownApps)
            sourceKind = "display"
            try await startPreview(filter: filter, width: choice.1.width, height: choice.1.height, name: choice.0, selectionID: selection)
        } catch {
            guard generation == selection else { return }
            await fail((error as? HostError).flatMap { if case .code(let code) = $0 { return code }; return nil } ?? "CAPTURE_SOURCE_FAILED", expected: selection)
        }
    }
    func chooseWindowFallback(requestID: String? = nil, permission: (() async -> Bool)? = nil) async {
        guard let selection = await beginSourceChoice(requestID: requestID, mode: "manual-window") else { return }
        defer { if generation == selection { choosingSource = false } }
        guard await authorizeScreenCapture(selection: selection, manualWindow: true, permission: permission), generation == selection else { return }
        emit(["type": "capture-state", "phase": "choosing", "permissionPending": false, "sourceKind": "window"])
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            guard generation == selection else { return }
            let choices = content.windows.filter(Self.manualWindowAllowed).map { window -> (String, SCWindow) in
                let app = window.owningApplication?.applicationName ?? "Приложение"
                let title = window.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return (String((title.isEmpty ? app : app + " · " + title).prefix(160)), window)
            }.sorted {
                let comparison = $0.0.localizedCaseInsensitiveCompare($1.0)
                return comparison == .orderedSame ? $0.1.windowID < $1.1.windowID : comparison == .orderedAscending
            }
            guard !choices.isEmpty else { throw HostError.code("CAPTURE_NO_SOURCES") }
            let alert = NSAlert(); alert.messageText = "Какое окно показать?"
            alert.informativeText = "Выберите учебное окно. Другие окна и пульт не передаются. Сначала проверьте предпросмотр."
            let select = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 460, height: 32))
            let labels = Self.uniqueMenuLabels(choices.map(\.0))
            select.menu = try Self.sourceMenu(labels: labels, sourceIDs: choices.map { $0.1.windowID })
            select.selectItem(at: 0)
            alert.accessoryView = select
            alert.addButton(withTitle: "Проверить кадр"); alert.addButton(withTitle: "Отмена")
            let response = await presentSelectionAlert(alert)
            guard generation == selection else { return }
            guard response == .alertFirstButtonReturn else { status(); return }
            let selectedID = (select.selectedItem?.representedObject as? NSNumber)?.uint32Value
            guard let selectedIndex = Self.menuChoiceIndex(selectedID: selectedID, sourceIDs: choices.map { $0.1.windowID }) else {
                throw HostError.code("CAPTURE_SOURCE_SELECTION_INVALID")
            }
            let choice = choices[selectedIndex]
            let filter = try Self.manualWindowFilter(choice.1)
            let rect = filter.contentRect, scale = Double(filter.pointPixelScale)
            guard rect.width.isFinite, rect.height.isFinite, scale.isFinite, rect.width > 0, rect.height > 0, scale > 0,
                  Double(rect.width) * scale <= 100_000, Double(rect.height) * scale <= 100_000 else { throw HostError.code("CAPTURE_SOURCE_GONE") }
            sourceKind = "window"
            try await startPreview(filter: filter, width: Int(Double(rect.width) * scale), height: Int(Double(rect.height) * scale), name: choice.0, selectionID: selection)
        } catch {
            guard generation == selection else { return }
            await fail((error as? HostError).flatMap { if case .code(let code) = $0 { return code }; return nil } ?? "CAPTURE_SOURCE_FAILED", expected: selection)
        }
    }
    static func manualWindowOwnerAllowed(pid: pid_t?, bundleID: String?) -> Bool {
        guard let pid, pid > 0, pid != ProcessInfo.processInfo.processIdentifier, let bundleID, !bundleID.isEmpty,
              !["ru.university.lecturer-projector.host", "ru.university.lecturer-projector"].contains(bundleID) else { return false }
        return true
    }
    static func manualWindowAllowed(_ window: SCWindow) -> Bool {
        manualWindowOwnerAllowed(pid: window.owningApplication?.processID, bundleID: window.owningApplication?.bundleIdentifier)
    }
    static func uniqueMenuLabels(_ labels: [String]) -> [String] {
        let totals = Dictionary(grouping: labels, by: { $0 }).mapValues(\.count)
        var seen: [String: Int] = [:]
        let reserved = Set(labels)
        var emitted = Set<String>()
        return labels.map { label in
            seen[label, default: 0] += 1
            guard (totals[label] ?? 0) > 1 else {
                emitted.insert(label)
                return label
            }
            let ordinal = seen[label] ?? 1
            var candidate = "\(label) · \(ordinal)"
            var collision = 1
            while reserved.contains(candidate) || emitted.contains(candidate) {
                candidate = "\(label) · \(ordinal) · \(collision)"
                collision += 1
            }
            emitted.insert(candidate)
            return candidate
        }
    }
    static func sourceMenu(labels: [String], sourceIDs: [UInt32]) throws -> NSMenu {
        guard labels.count == sourceIDs.count, Set(sourceIDs).count == sourceIDs.count else {
            throw HostError.code("CAPTURE_SOURCE_MENU_IDENTITY_INVALID")
        }
        let menu = NSMenu(title: "")
        menu.autoenablesItems = false
        for index in labels.indices {
            let item = NSMenuItem(title: labels[index], action: nil, keyEquivalent: "")
            item.representedObject = NSNumber(value: sourceIDs[index])
            item.isEnabled = true
            menu.addItem(item)
        }
        return menu
    }
    static func menuChoiceIndex(selectedID: UInt32?, sourceIDs: [UInt32]) -> Int? {
        guard let selectedID else { return nil }
        let matches = sourceIDs.indices.filter { sourceIDs[$0] == selectedID }
        guard matches.count == 1 else { return nil }
        return matches[0]
    }
    static func manualWindowFilter(_ window: SCWindow) throws -> SCContentFilter {
        guard manualWindowAllowed(window) else { throw HostError.code("CAPTURE_PRIVATE_SOURCE_REJECTED") }
        return exactWindowFilter(window)
    }
    static func exactWindowFilter(_ window: SCWindow) -> SCContentFilter { SCContentFilter(desktopIndependentWindow: window) }
    static func exerciseManualSelectionFixture() async throws -> [String: Any] {
        let repeatedTitle = "Редактор · Учебный проект"
        let naturalSuffix = repeatedTitle + " · 1"
        let duplicateLabels = uniqueMenuLabels([repeatedTitle, repeatedTitle, naturalSuffix])
        let duplicateSourceIDs: [UInt32] = [1042, 2084]
        let menu = try sourceMenu(labels: duplicateLabels, sourceIDs: [1042, 2084, 3126])
        let selectedObject = menu.item(at: 1)?.representedObject as? NSNumber
        guard duplicateLabels == [repeatedTitle + " · 1 · 1", repeatedTitle + " · 2", naturalSuffix],
              !menu.autoenablesItems,
              menu.numberOfItems == 3,
              menu.item(at: 0)?.title == duplicateLabels[0],
              menu.item(at: 1)?.title == duplicateLabels[1],
              menu.item(at: 2)?.title == duplicateLabels[2],
              menu.item(at: 0)?.isEnabled == true,
              menu.item(at: 1)?.isEnabled == true,
              menu.item(at: 2)?.isEnabled == true,
              (menu.item(at: 0)?.representedObject as? NSNumber)?.uint32Value == 1042,
              selectedObject?.uint32Value == 2084,
              (menu.item(at: 2)?.representedObject as? NSNumber)?.uint32Value == 3126,
              menuChoiceIndex(selectedID: duplicateSourceIDs[1], sourceIDs: duplicateSourceIDs) == 1,
              menuChoiceIndex(selectedID: nil, sourceIDs: duplicateSourceIDs) == nil,
              menuChoiceIndex(selectedID: 9999, sourceIDs: duplicateSourceIDs) == nil,
              menuChoiceIndex(selectedID: duplicateSourceIDs[1], sourceIDs: [duplicateSourceIDs[1], duplicateSourceIDs[1]]) == nil,
              (try? sourceMenu(labels: ["one", "two"], sourceIDs: [7, 7])) == nil else {
            throw HostError.code("CAPTURE_MENU_STABLE_SELECTION_FIXTURE_FAILED")
        }
        let own = ProcessInfo.processInfo.processIdentifier
        guard !manualWindowOwnerAllowed(pid: own, bundleID: "org.example.fixture"),
              !manualWindowOwnerAllowed(pid: own + 1, bundleID: "ru.university.lecturer-projector.host"),
              !manualWindowOwnerAllowed(pid: own + 1, bundleID: "ru.university.lecturer-projector"),
              !manualWindowOwnerAllowed(pid: nil, bundleID: nil),
              !manualWindowOwnerAllowed(pid: 0, bundleID: "org.example.fixture"),
              manualWindowOwnerAllowed(pid: own + 1, bundleID: "org.example.educational") else { throw HostError.code("MANUAL_WINDOW_OWNER_POLICY_FAILED") }
        let capture = NativeCapture()
        var events: [[String: Any]] = [], permissionCalls = 0
        capture.event = { events.append($0) }
        let oldID = UUID().uuidString.lowercased(), manualID = UUID().uuidString.lowercased()
        let previous = Task {
            await capture.chooseSource(requestID: oldID, selection: {
                try await Task.sleep(for: .milliseconds(150)); throw HostError.code("FIXTURE_OLD_SOURCE_FAILED")
            })
        }
        try await Task.sleep(for: .milliseconds(20))
        let switchIndex = events.count
        await capture.chooseWindowFallback(requestID: manualID, permission: { permissionCalls += 1; return false })
        await previous.value
        let switched = Array(events.dropFirst(switchIndex))
        guard permissionCalls == 1, !capture.isActive, !capture.usesSystemPickerGrant,
              switched.first?["phase"] as? String == "permission",
              switched.first?["sourceKind"] as? String == "window",
              switched.first?["permissionPending"] as? Bool == true,
              switched.allSatisfy({ $0["requestId"] as? String == manualID && $0["captureMode"] as? String == "manual-window" }),
              !switched.contains(where: { $0["phase"] as? String == "idle" || $0["phase"] as? String == "preview" }),
              switched.last?["code"] as? String == "CAPTURE_MANUAL_PERMISSION_REQUIRED" else { throw HostError.code("MANUAL_WINDOW_SWITCH_OR_PERMISSION_FAILED") }
        let cancelled = Task { await capture.chooseSource(requestID: UUID().uuidString, selection: { try await Task.sleep(for: .milliseconds(100)); return nil }) }
        try await Task.sleep(for: .milliseconds(20)); await capture.stop()
        let stoppedEvents = events.count; await cancelled.value
        guard !capture.isActive, events.count == stoppedEvents, events.last?["phase"] as? String == "idle" else { throw HostError.code("MANUAL_WINDOW_CANCEL_REVIVED_SELECTION") }
        let pendingPermission = Task {
            await capture.chooseWindowFallback(requestID: UUID().uuidString, permission: { try? await Task.sleep(for: .milliseconds(100)); return false })
        }
        try await Task.sleep(for: .milliseconds(20)); await capture.stop()
        let cancelledPermissionEvents = events.count; await pendingPermission.value
        guard events.count == cancelledPermissionEvents, !capture.isActive else { throw HostError.code("MANUAL_WINDOW_CANCEL_REVIVED_PERMISSION") }
        let terminalID = UUID().uuidString.lowercased(), terminalIndex = events.count
        await capture.chooseSource(requestID: terminalID, selection: { throw HostError.code("CAPTURE_SYSTEM_PICKER_TIMED_OUT") })
        let terminal = Array(events.dropFirst(terminalIndex))
        guard terminal.count == 2, terminal.first?["phase"] as? String == "choosing",
              terminal.last?["type"] as? String == "error", terminal.last?["code"] as? String == "CAPTURE_SYSTEM_PICKER_TIMED_OUT",
              terminal.allSatisfy({ $0["requestId"] as? String == terminalID && $0["captureMode"] as? String == "system-window" }),
              !terminal.contains(where: { $0["phase"] as? String == "idle" }), !capture.isActive else { throw HostError.code("CAPTURE_TERMINAL_ERROR_LOST_REQUEST_ID") }
        return ["manualWindowOwnerExclusion": true, "manualPermissionExplicit": true,
                "manualDenialStopsBeforeEnumeration": true, "selectionReplacementNoIdle": true,
                "requestIDsEchoed": true, "lateSourceResultRejected": true,
                "cancelInvalidatesPendingSelection": true, "cancelInvalidatesPendingPermission": true,
                "duplicateWindowTitlesDisambiguated": true, "menuSelectionUsesStableIdentity": true,
                "naturalSuffixCollisionAvoided": true, "menuItemCountAndIdentityPreserved": true,
                "sourceMenuItemsRemainEnabled": true,
                "manualPathDoesNotActivatePicker": true]
    }
    static func exerciseSnapshotFixture() async throws -> [String: Any] {
        let capture = NativeCapture(), course = UUID(), session = UUID(), selectionID = UUID().uuidString.lowercased()
        let fixtureToken = "fixture-private-device-token", fixtureOrigin = URL(string: "https://snapshot.example/")!
        capture.bind(NativeCaptureScope(origin: fixtureOrigin, courseID: course, sessionID: session, token: fixtureToken))
        var events: [[String: Any]] = []
        capture.event = { events.append($0) }
        let pending = Task { await capture.chooseSource(requestID: selectionID, selection: { try await Task.sleep(for: .milliseconds(120)); return nil }) }
        try await Task.sleep(for: .milliseconds(20))
        let generation = capture.generation
        let phases = ["choosing", "permission", "preview", "live", "paused", "error"]
        for phase in phases {
            // Feed the same local state reducer used by real capture callbacks;
            // no stream, picker, permission request or publisher is created.
            if phase == "error" { capture.emitError("CAPTURE_SYSTEM_PICKER_TIMED_OUT") }
            else { capture.emit(["type": "capture-state", "phase": phase, "permissionPending": phase == "permission"]) }
            let sync = UUID().uuidString.lowercased(), count = events.count
            capture.snapshot(syncID: sync)
            guard events.count == count + 1, let snapshot = events.last,
                  snapshot["type"] as? String == "capture-snapshot", snapshot["syncId"] as? String == sync,
                  snapshot["requestId"] as? String == selectionID, sync != selectionID,
                  snapshot["courseId"] as? String == course.uuidString.lowercased(), snapshot["sessionId"] as? String == session.uuidString.lowercased(),
                  snapshot["phase"] as? String == phase, snapshot["captureMode"] as? String == "system-window",
                  snapshot["permissionPending"] as? Bool == (phase == "permission"),
                  capture.generation == generation, capture.selectionRequestID == selectionID else { throw HostError.code("CAPTURE_SNAPSHOT_IDENTITY_OR_PHASE_FAILED") }
            let bytes = try JSONSerialization.data(withJSONObject: snapshot), text = String(decoding: bytes, as: UTF8.self)
            guard !text.contains(fixtureToken), !text.contains(fixtureOrigin.host!),
                  snapshot["origin"] == nil, snapshot["token"] == nil, snapshot["controlToken"] == nil,
                  snapshot["joinCode"] == nil else { throw HostError.code("CAPTURE_SNAPSHOT_LEAKED_CREDENTIALS") }
        }
        // A rebinding cannot relabel an older in-flight selection as a different lecture.
        capture.currentScope = NativeCaptureScope(origin: fixtureOrigin, courseID: UUID(), sessionID: UUID(), token: fixtureToken)
        capture.snapshot(syncID: UUID().uuidString)
        guard events.last?["courseId"] as? String == course.uuidString.lowercased(),
              events.last?["sessionId"] as? String == session.uuidString.lowercased() else { throw HostError.code("CAPTURE_SNAPSHOT_RELABELED_OLD_SELECTION") }
        let count = events.count; capture.snapshot(syncID: "not-a-uuid")
        guard events.count == count else { throw HostError.code("CAPTURE_SNAPSHOT_ACCEPTED_INVALID_SYNC") }
        await capture.stop(); await pending.value
        capture.snapshot(syncID: UUID().uuidString)
        guard events.last?["phase"] as? String == "idle", !capture.isActive else { throw HostError.code("CAPTURE_SNAPSHOT_REVIVED_STOPPED_CAPTURE") }
        let replacing = NativeCapture(), replacementCourse = UUID(), replacementSession = UUID()
        replacing.bind(NativeCaptureScope(origin: fixtureOrigin, courseID: replacementCourse, sessionID: replacementSession, token: fixtureToken))
        var firstGate: CheckedContinuation<Void, Never>?, secondGate: CheckedContinuation<Void, Never>?, selectionCalls = 0
        var replacementSnapshots: [[String: Any]] = []
        replacing.event = { replacementSnapshots.append($0) }
        let firstID = UUID().uuidString.lowercased(), secondID = UUID().uuidString.lowercased()
        let first = Task {
            await replacing.chooseSource(requestID: firstID, replacementTeardown: {
                await withCheckedContinuation { firstGate = $0 }
            }, selection: { selectionCalls += 1; return nil })
        }
        try await Task.sleep(for: .milliseconds(20))
        guard let releaseFirst = firstGate, replacing.capturePhase == "idle", !replacing.choosingSource, replacing.isActive else { throw HostError.code("CAPTURE_SNAPSHOT_TEARDOWN_FIXTURE_NOT_PENDING") }
        replacing.snapshot(syncID: UUID().uuidString)
        guard replacementSnapshots.last?["phase"] as? String == "choosing", replacementSnapshots.last?["requestId"] as? String == firstID,
              replacementSnapshots.last?["courseId"] as? String == replacementCourse.uuidString.lowercased(),
              replacementSnapshots.last?["sessionId"] as? String == replacementSession.uuidString.lowercased() else { throw HostError.code("CAPTURE_SNAPSHOT_TEARDOWN_REPORTED_IDLE") }
        let second = Task {
            await replacing.chooseSource(requestID: secondID, replacementTeardown: {
                await withCheckedContinuation { secondGate = $0 }
            }, selection: { selectionCalls += 1; return nil })
        }
        try await Task.sleep(for: .milliseconds(20))
        guard let releaseSecond = secondGate else { throw HostError.code("CAPTURE_SNAPSHOT_REPLACEMENT_NOT_PENDING") }
        releaseFirst.resume(); await first.value
        replacing.snapshot(syncID: UUID().uuidString)
        guard selectionCalls == 0, replacementSnapshots.last?["phase"] as? String == "choosing",
              replacementSnapshots.last?["requestId"] as? String == secondID else { throw HostError.code("CAPTURE_SNAPSHOT_OLDER_TEARDOWN_WON") }
        await replacing.stop(); let stoppedCount = replacementSnapshots.count
        releaseSecond.resume(); await second.value
        guard selectionCalls == 0, replacementSnapshots.count == stoppedCount, !replacing.isActive else { throw HostError.code("CAPTURE_SNAPSHOT_CANCEL_REVIVED_TEARDOWN") }
        replacing.snapshot(syncID: UUID().uuidString)
        guard replacementSnapshots.last?["phase"] as? String == "idle" else { throw HostError.code("CAPTURE_SNAPSHOT_CANCEL_LEFT_PENDING_CHOICE") }
        return ["snapshotSyncIndependentOfSelection": true, "snapshotScopeAndPhasesPreserved": true,
                "snapshotExcludesCredentials": true, "snapshotDoesNotMutateSelection": true]
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
        if usesSystemPickerGrant { SCContentSharingPicker.shared.setConfiguration(SystemSourcePicker.configuration(windowIDs: NSApp.windows.map(\.windowNumber)), for: active) }
        try await active.startCapture()
        guard generation == selectionID else { try? await active.stopCapture(); return }
        emit(["type": "capture-state", "phase": "preview", "sourceName": sourceName, "sourceKind": sourceKind,
                "captureExcludesRemote": true, "permissionPending": false, "previewOnly": true])
    }
    func beginOwnPreviewFixture(window: SCWindow, ownWindow: NSWindow) async throws {
        guard window.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier else { throw HostError.code("CAPTURE_FIXTURE_NOT_OWN_WINDOW") }
        guard Int(window.windowID) == ownWindow.windowNumber else { throw HostError.code("CAPTURE_FIXTURE_WINDOW_MISMATCH") }
        await stop(); sourceKind = "window"
        // currentProcess metadata can report zero geometry without global
        // consent. The fixture knows the size of its own verified NSWindow; the
        // authorized content filter remains unchanged, as does production validation.
        let filter = Self.exactWindowFilter(window)
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
    private func authorizeScreenCapture(selection: UUID, manualWindow: Bool = false, permission: (() async -> Bool)? = nil) async -> Bool {
        emit(["type": "capture-state", "phase": "permission", "permissionPending": true, "sourceKind": manualWindow ? "window" : "display"])
        let granted: Bool
        if let permission { granted = await permission() }
        else {
            granted = await displayAuthorization.request(preflight: { CGPreflightScreenCaptureAccess() }, activate: { NSApp.activate(ignoringOtherApps: true) }, prompt: {
                await CaptureAuthorization.offMainPrompt { CGRequestScreenCaptureAccess() }
            })
        }
        if granted { return true }
        guard generation == selection else { return false }
        emitError(manualWindow ? "CAPTURE_MANUAL_PERMISSION_REQUIRED" : "SCREEN_RECORDING_PERMISSION_REQUIRED")
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
            let publisher = NativeMediaPublisher(scope: scope) { [weak self] code in Task { @MainActor in await self?.fail(code, expected: current) } }
            self.publisher = publisher
            let id = try await publisher.start(name: sourceName)
            guard generation == current else { await publisher.stop(); return }
            try prepareWriter()
            pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in Task { @MainActor in
                guard let self, self.generation == current, let publisher = self.publisher else { return }
                do {
                    let paused = try await publisher.poll()
                    guard self.generation == current else { return }
                    await self.applyPaused(paused)
                    guard self.generation == current else { return }
                    self.emit(["type": "capture-state", "phase": paused ? "paused" : "live", "sourceName": self.sourceName])
                } catch { await self.fail("CAPTURE_LEASE_LOST", expected: current) }
            } }
            emit(["type": "capture-state", "phase": "live", "shareId": id, "sourceName": sourceName, "captureExcludesRemote": true])
        } catch { await fail("CAPTURE_START_FAILED", expected: current) }
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
        let current = generation, activePublisher = publisher
        let needsEpoch = await activePublisher?.needsVideoEpoch() ?? false
        guard generation == current else { return }
        let staleEpoch = !value && needsEpoch
        guard paused != value || staleEpoch else { return }; paused = value
        await activePublisher?.suspend(value)
        guard generation == current else { return }
        if capturePhase == "live" || capturePhase == "paused" { capturePhase = value ? "paused" : "live" }
        frameTimer?.invalidate(); frameTimer = nil; writerInput?.markAsFinished(); writer?.cancelWriting(); writerInput = nil; adaptor = nil; writer = nil; firstPTS = nil
        if !value { do { try prepareWriter() } catch { await fail("CAPTURE_RESUME_FAILED", expected: current) } }
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
            if now - lastPreview > 0.5, let jpeg = jpeg(buffer, quality: 0.65) { lastPreview = now; emit(["type": "preview", "phase": "preview", "frameUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "sourceName": sourceName, "captureExcludesRemote": true]) }
            return
        }
    }
    private func encodeFrame() {
        guard !paused, let buffer = latestBuffer, let publisher else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if let writer, let input = writerInput, let adaptor, input.isReadyForMoreMediaData {
            let time = CMTime(seconds: now - startedAt, preferredTimescale: 600)
            if !adaptor.append(buffer, withPresentationTime: time) { let current = generation; Task { await fail("CAPTURE_ENCODER_FAILED", expected: current) }; return }
            if writer.status == .failed { let current = generation; Task { await fail("CAPTURE_ENCODER_FAILED", expected: current) }; return }
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
            } catch { await self.fail("CAPTURE_MP4_FAILED", expected: self.generation) }
        }
    }
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor [weak self] in guard let self, self.stream === stream else { return }; await self.fail("CAPTURE_SOURCE_STOPPED", expected: self.generation) }
    }
    func stop(emitState: Bool = true, replacementGeneration: UUID = UUID(), teardownPause: (() async -> Void)? = nil) async {
        generation = replacementGeneration; choosingSource = false; usesSystemPickerGrant = false; pollTimer?.invalidate(); pollTimer = nil
        if pendingSourceChoice?.generation != replacementGeneration { pendingSourceChoice = nil }
        capturePhase = "idle"; capturePermissionPending = false; captureError = nil; selectionScope = nil
        selectionDialog.cancel()
        let active = stream; stream = nil; latestBuffer = nil
        systemPicker.deactivate()
        frameTimer?.invalidate(); frameTimer = nil; writerInput?.markAsFinished(); writer?.cancelWriting(); writerInput = nil; adaptor = nil; writer = nil; firstPTS = nil
        let previous = publisher; publisher = nil; paused = false
        if emitState { emit(["type": "capture-state", "phase": "idle"]) }
        await teardownPause?()
        try? await active?.stopCapture(); await previous?.stop()
    }
    func status() { emit(["type": "capture-state", "phase": publisher == nil ? (stream == nil ? "idle" : "preview") : (paused ? "paused" : "live"), "sourceName": sourceName, "captureExcludesRemote": true]) }
    func snapshot(syncID: String) {
        guard let sync = UUID(uuidString: syncID) else { return }
        let pending = pendingSourceChoice.flatMap { $0.generation == generation ? $0 : nil }
        let phase = pending != nil || (publisher != nil && capturePhase == "preview") ? "choosing" : capturePhase
        var value: [String: Any] = ["type": "capture-snapshot", "syncId": sync.uuidString.lowercased(),
            "phase": phase, "captureMode": pending?.mode ?? captureMode, "sourceName": sourceName,
            "sourceKind": sourceKind, "captureExcludesRemote": true, "permissionPending": pending == nil && capturePermissionPending]
        let scope: (courseID: UUID, sessionID: UUID)?
        if let pending { scope = pending.scope }
        else { scope = selectionScope ?? currentScope.map { (courseID: $0.courseID, sessionID: $0.sessionID) } }
        if let scope {
            value["courseId"] = scope.courseID.uuidString.lowercased(); value["sessionId"] = scope.sessionID.uuidString.lowercased()
        }
        if let requestID = pending?.requestID ?? selectionRequestID { value["requestId"] = requestID }
        if pending == nil, let captureError { value["code"] = captureError.code; value["message"] = captureError.message }
        if phase == "preview", let latestBuffer, let frame = jpeg(latestBuffer, quality: 0.65) {
            value["frameUrl"] = "data:image/jpeg;base64," + frame.base64EncodedString()
        }
        // A sync reply is scoped to the newly loaded remote, independently of
        // the older source-selection request that it may choose to adopt.
        event?(value)
    }
    private func fail(_ code: String, expected: UUID) async {
        guard generation == expected else { return }
        let terminal = UUID()
        await stop(emitState: false, replacementGeneration: terminal)
        guard generation == terminal else { return }
        emitError(code)
    }
    private func emitError(_ code: String) {
        let message: String
        switch code {
        case "CAPTURE_SYSTEM_PICKER_TIMED_OUT", "CAPTURE_SYSTEM_PICKER_FAILED": message = "macOS не завершила выбор источника. Повторите попытку или выберите «Окно вручную» либо «Весь экран». Для этих способов нужно разрешение записи экрана macOS."
        case "CAPTURE_MANUAL_PERMISSION_REQUIRED": message = "Для ручного выбора окна нужно разрешение записи экрана macOS. Системный выбор окна можно попробовать без него. Если доступ уже выдан, сохраните диагностику — повторно переключать его не нужно."
        case "SCREEN_RECORDING_PERMISSION_REQUIRED": message = "Для всего экрана требуется отдельное разрешение macOS. Можно продолжить через «Окно или приложение» без изменения настроек. Если доступ уже выдан, сохраните диагностику — повторно переключать его не нужно."
        case "CAPTURE_PRIVATE_WINDOW_EXCLUSION_UNAVAILABLE", "CAPTURE_PRIVATE_SOURCE_REJECTED", "CAPTURE_UNPROTECTED_DISPLAY_REJECTED": message = "Этот источник нельзя показать, сохранив пульт приватным. Выберите отдельное учебное окно или приложение. Пульт не будет опубликован."
        case "CAPTURE_SELECT_SOURCE_FIRST": message = "Сначала выберите окно или экран и проверьте предпросмотр."
        case "CAPTURE_CONNECTION_TOO_SLOW", "CAPTURE_UPLOAD_FAILED", "CAPTURE_LEASE_LOST": message = "Демонстрация остановлена: нет устойчивой связи с сервером. Проверьте подключение и запустите показ заново."
        case "CAPTURE_SOURCE_STOPPED", "CAPTURE_SOURCE_FAILED": message = "Источник больше недоступен или macOS не разрешила запись. Выберите окно или экран заново."
        case "CAPTURE_PAUSE_FAILED": message = "Не удалось изменить паузу. Проверьте состояние занятия на сайте."
        default: message = "Не удалось продолжить демонстрацию. Выберите источник заново. Код: " + code
        }
        emit(["type": "error", "code": code, "message": message, "permissionPending": false])
    }
    private func emit(_ payload: [String: Any]) {
        var value = payload
        switch payload["type"] as? String {
        case "capture-state", "preview":
            if let phase = payload["phase"] as? String { capturePhase = phase }
            capturePermissionPending = payload["permissionPending"] as? Bool ?? (capturePhase == "permission")
            captureError = nil
        case "error":
            capturePhase = "error"; capturePermissionPending = false
            if let code = payload["code"] as? String, let message = payload["message"] as? String { captureError = (code, message) }
        default: break
        }
        if let selectionRequestID { value["requestId"] = selectionRequestID }
        value["captureMode"] = captureMode
        event?(value)
    }
}
