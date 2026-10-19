import AppKit
import WebKit

/// A separate native surface. Its data store never contains browser staff credentials.
@MainActor final class RemoteWindow: NSObject, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private var panel: NSPanel?
    private var web: WKWebView?
    private var allowedURL: URL?
    var command: (([String: Any]) -> Void)?
    var closed: (() -> Void)?

    static func allowed(_ candidate: URL, origin: URL) -> Bool {
        guard candidate.scheme == "https", candidate.host == origin.host, candidate.port == origin.port,
              candidate.user == nil, candidate.password == nil, candidate.path == "/", candidate.query == nil,
              let fragment = candidate.fragment, let route = URLComponents(string: "https://local" + fragment),
              route.path == "/helper/remote" else { return false }
        let items = route.queryItems ?? []
        guard items.count == 3, Set(items.map(\.name)) == ["courseId", "sessionId", "controlToken"],
              UUID(uuidString: items.first(where: { $0.name == "courseId" })?.value ?? "") != nil,
              UUID(uuidString: items.first(where: { $0.name == "sessionId" })?.value ?? "") != nil else { return false }
        return validToken(items.first(where: { $0.name == "controlToken" })?.value ?? "")
    }
    static func validToken(_ token: String) -> Bool {
        let pieces = token.split(separator: ".", omittingEmptySubsequences: false)
        return pieces.count == 2 && UUID(uuidString: String(pieces[0])) != nil && pieces[1].count == 64
            && pieces[1].utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    static func matches(_ candidate: URL, courseID: UUID, sessionID: UUID, token: String) -> Bool {
        guard let fragment = candidate.fragment, let items = URLComponents(string: "https://local" + fragment)?.queryItems else { return false }
        return UUID(uuidString: items.first(where: { $0.name == "courseId" })?.value ?? "") == courseID
            && UUID(uuidString: items.first(where: { $0.name == "sessionId" })?.value ?? "") == sessionID
            && items.first(where: { $0.name == "controlToken" })?.value == token
    }
    func show(url: URL, origin: URL) throws {
        guard Self.allowed(url, origin: origin) else { throw HostError.code("REMOTE_URL_REJECTED") }
        if allowedURL == url, let panel { panel.orderFrontRegardless(); return }
        close(notify: false)
        allowedURL = url
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "lectureNative")
        config.userContentController.addUserScript(WKUserScript(source: "window.lectureProjectorNative={platform:'MACOS',nativeCapture:true,captureExclusion:{supported:true,enabled:true},postMessage:function(message){window.webkit.messageHandlers.lectureNative.postMessage(message)}};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 420, height: 560), styleMask: [.borderless, .resizable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Пульт · Lecturer Assistant"; panel.titleVisibility = .hidden; panel.titlebarAppearsTransparent = true
        panel.isReleasedWhenClosed = false; panel.level = .floating; panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 264, height: 64); panel.maxSize = NSSize(width: 520, height: 900)
        panel.isMovableByWindowBackground = false; panel.delegate = self
        panel.hasShadow = true
        panel.contentView?.wantsLayer = true; panel.contentView?.layer?.cornerRadius = 12; panel.contentView?.layer?.masksToBounds = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        // The remote's drag handle calls performDrag; no extra OS titlebar or traffic lights.
        web.frame = NSRect(x: 0, y: 0, width: 420, height: 560); web.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(web)
        if let bounds = NSScreen.main?.visibleFrame { panel.setFrameTopLeftPoint(NSPoint(x: bounds.maxX - 440, y: bounds.maxY - 20)) }
        self.web = web; self.panel = panel
        web.load(URLRequest(url: url)); panel.orderFrontRegardless()
    }
    func resize(width: Double, height: Double) {
        guard width.isFinite, height.isFinite, let panel else { return }
        let frame = panel.frame, bounds = panel.screen?.visibleFrame ?? frame
        let size = NSSize(width: min(max(width, 264), min(520, bounds.width)), height: min(max(height, 64), bounds.height - 20))
        panel.setFrame(NSRect(x: min(frame.minX, bounds.maxX - size.width), y: max(bounds.minY, frame.maxY - size.height), width: size.width, height: size.height), display: true)
    }
    func emit(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('lecture-projector-native',{detail:\(json)}))", completionHandler: nil)
    }
    func close(notify: Bool = true) {
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "lectureNative")
        web?.stopLoading(); web?.removeFromSuperview(); web = nil; allowedURL = nil
        panel?.delegate = nil; panel?.close(); panel = nil
        if notify { closed?() }
    }
    func windowWillClose(_ notification: Notification) { close() }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let expected = allowedURL, let current = web?.url,
              current == expected, message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == expected.host,
              let value = message.body as? [String: Any], value["type"] as? String == "LECTURE_REMOTE", let type = value["action"] as? String else { return }
        switch type {
        case "resize": resize(width: (value["width"] as? NSNumber)?.doubleValue ?? 420, height: (value["height"] as? NSNumber)?.doubleValue ?? 560)
        case "close": close()
        case "drag": if let event = NSApp.currentEvent { panel?.performDrag(with: event) }
        case "chooseSource", "publish", "stopCapture", "pause", "ready", "capabilities", "screenRecordingSettings", "focusProjection": command?(value)
        default: break
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { emit(["type": "capabilities", "platform": "MACOS", "nativeCapture": true, "captureExclusion": ["supported": true, "enabled": true]]) }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame == true, action.request.url == allowedURL else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
}

@MainActor final class ScreenIdentification {
    private var overlays: [NSPanel] = []
    private var timer: Timer?
    func show() {
        dismiss()
        for (index, screen) in NSScreen.screens.prefix(16).enumerated() {
            let width: CGFloat = 260, height: CGFloat = 200
            let panel = NSPanel(contentRect: NSRect(x: screen.frame.midX - width / 2, y: screen.frame.midY - height / 2, width: width, height: height), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false, screen: screen)
            panel.isOpaque = false; panel.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96)
            panel.level = .screenSaver; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.ignoresMouseEvents = true; panel.isReleasedWhenClosed = false
            let label = NSTextField(labelWithString: "\(index + 1)\n" + screen.localizedName)
            label.font = .systemFont(ofSize: 44, weight: .bold); label.alignment = .center
            label.frame = NSRect(x: 16, y: 20, width: width - 32, height: height - 40)
            panel.contentView?.addSubview(label); panel.orderFrontRegardless(); overlays.append(panel)
        }
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in Task { @MainActor in self?.dismiss() } }
    }
    func dismiss() { timer?.invalidate(); timer = nil; overlays.forEach { $0.close() }; overlays.removeAll() }
}
