import AppKit
import WebKit

/// Borderless panels need an explicit keyboard-focus contract for WKWebView text entry.
@MainActor private final class NativeRemotePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// A separate native surface. Its data store never contains browser staff credentials.
@MainActor final class RemoteWindow: NSObject, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private var panel: NSPanel?
    private var web: WKWebView?
    private var allowedURL: URL?
    private var theme = "light"
    var command: (([String: Any]) -> Void)?
    var closed: (() -> Void)?
    var isPresented: Bool { panel != nil }
    var presentationWindow: NSWindow? { panel }

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
        let config = configuration()
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        let panel = makePanel(web: web)
        self.web = web; self.panel = panel
        web.load(URLRequest(url: url)); panel.orderFrontRegardless()
    }
    private func configuration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "lectureNative")
        config.userContentController.addUserScript(WKUserScript(source: "window.lectureProjectorNative={platform:'MACOS',nativeCapture:true,theme:'\(theme)',captureExclusion:{supported:true,enabled:true},postMessage:function(message){window.webkit.messageHandlers.lectureNative.postMessage(message)}};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        return config
    }
    func setTheme(_ value: String) throws {
        guard value == "light" || value == "dark" else { throw HostError.code("REMOTE_THEME_REJECTED") }
        theme = value
        panel?.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
        applyTheme()
    }
    private func applyTheme() {
        web?.evaluateJavaScript("if(window.lectureProjectorNative){window.lectureProjectorNative.theme='\(theme)';window.dispatchEvent(new CustomEvent('lecture-projector-theme',{detail:{theme:'\(theme)'}}));}", completionHandler: nil)
    }
    private func makePanel(web: WKWebView) -> NSPanel {
        let panel = NativeRemotePanel(contentRect: NSRect(x: 0, y: 0, width: 420, height: 560), styleMask: [.borderless, .resizable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Пульт · Lecturer Assistant"; panel.titleVisibility = .hidden; panel.titlebarAppearsTransparent = true
        panel.isReleasedWhenClosed = false; panel.level = .floating; panel.hidesOnDeactivate = false
        panel.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 264, height: 64); panel.maxSize = NSSize(width: 520, height: 900)
        panel.isMovableByWindowBackground = false; panel.becomesKeyOnlyIfNeeded = false; panel.delegate = self
        panel.hasShadow = true
        panel.contentView?.wantsLayer = true; panel.contentView?.layer?.cornerRadius = 12; panel.contentView?.layer?.masksToBounds = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        // The remote's drag handle calls performDrag; no extra OS titlebar or traffic lights.
        web.frame = NSRect(x: 0, y: 0, width: 420, height: 560); web.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(web)
        if let bounds = NSScreen.main?.visibleFrame { panel.setFrameTopLeftPoint(NSPoint(x: bounds.maxX - 440, y: bounds.maxY - 20)) }
        return panel
    }
    static func captureParentFixture() -> RemoteWindow {
        let remote = RemoteWindow()
        let web = WKWebView(frame: .zero, configuration: remote.configuration())
        let panel = remote.makePanel(web: web); remote.web = web; remote.panel = panel
        panel.alphaValue = 0; panel.setFrameOrigin(NSPoint(x: 50_000, y: 50_000))
        web.loadHTMLString("<!doctype html><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'\"><p>Isolated capture dialog parent</p>", baseURL: nil)
        return remote
    }
    static func exerciseHiddenThemeFixture() async throws -> [String: Any] {
        let remote = RemoteWindow(); try remote.setTheme("dark")
        guard remote.panel == nil else { throw HostError.code("WORKSPACE_THEME_OPENED_REMOTE") }
        let web = WKWebView(frame: .zero, configuration: remote.configuration())
        let panel = remote.makePanel(web: web); remote.web = web; remote.panel = panel
        defer { remote.close(notify: false) }
        web.loadHTMLString("<!doctype html><html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'\"></head><body><textarea id='answer'></textarea></body></html>", baseURL: nil)
        let deadline = Date().addingTimeInterval(20)
        var ready = false
        while Date() < deadline {
            if (try? await web.evaluateJavaScript("document.readyState==='complete' && !!document.getElementById('answer')")) as? Bool == true { ready = true; break }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard ready, (try await web.evaluateJavaScript("window.lectureProjectorNative.theme")) as? String == "dark",
              panel.appearance?.name == .darkAqua, !panel.isVisible else { throw HostError.code("WORKSPACE_INITIAL_THEME") }
        _ = try await web.evaluateJavaScript("document.getElementById('answer').value='Сохранённый ответ';window.addEventListener('lecture-projector-theme',e=>{document.documentElement.dataset.fixtureTheme=e.detail.theme});")
        try remote.setTheme("light")
        guard (try await web.evaluateJavaScript("document.documentElement.dataset.fixtureTheme")) as? String == "light",
              (try await web.evaluateJavaScript("document.getElementById('answer').value")) as? String == "Сохранённый ответ",
              panel.appearance?.name == .aqua, !panel.isVisible else { throw HostError.code("WORKSPACE_LIVE_THEME_RELOADED") }
        do { try remote.setTheme("unknown"); throw HostError.code("WORKSPACE_INVALID_THEME_ACCEPTED") }
        catch HostError.code(let code) { guard code == "REMOTE_THEME_REJECTED" else { throw HostError.code(code) } }
        remote.close(notify: false)
        guard remote.panel == nil, remote.web == nil else { throw HostError.code("WORKSPACE_REMOTE_CLOSE") }
        return ["initialThemeBeforeWebBootstrap": true, "themeUpdatedWithoutReload": true, "answerPreserved": true,
                "invalidThemeRejected": true, "nativeAppearanceUpdated": true, "allWindowsHidden": true]
    }
    /// Exercises the same window factory with local content only. No institution/session is opened.
    static func exerciseLocalFixture() async throws -> [String: Any] {
        let remote = RemoteWindow()
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: configuration)
        let panel = remote.makePanel(web: web); remote.web = web; remote.panel = panel
        let previous = NSWorkspace.shared.frontmostApplication
        defer {
            remote.close(notify: false)
            if let previous, previous.processIdentifier != ProcessInfo.processInfo.processIdentifier { previous.activate(options: []) }
        }
        web.loadHTMLString("<!doctype html><html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><style>body{font:16px system-ui;margin:16px}textarea{box-sizing:border-box;width:100%;height:100px;font:16px system-ui}</style></head><body><label for='reply'>Локальная проверка ответа</label><textarea id='reply'></textarea></body></html>", baseURL: nil)
        panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        guard panel.canBecomeKey, !panel.canBecomeMain else { throw HostError.code("REMOTE_FIXTURE_KEY_CONTRACT") }
        let deadline = Date().addingTimeInterval(20)
        var ready = false
        while Date() < deadline {
            if (try? await web.evaluateJavaScript("document.readyState==='complete' && !!document.getElementById('reply')")) as? Bool == true { ready = true; break }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard ready else { throw HostError.code("REMOTE_FIXTURE_WEB_CONTENT_TIMEOUT") }
        guard panel.makeFirstResponder(web) else { throw HostError.code("REMOTE_FIXTURE_FIRST_RESPONDER") }
        _ = try await web.evaluateJavaScript("document.getElementById('reply').focus();document.activeElement.id")
        try await Task.sleep(for: .milliseconds(150))
        let active = try await web.evaluateJavaScript("document.activeElement.id") as? String
        guard active == "reply", panel.isKeyWindow, let input = panel.firstResponder as? NSTextInputClient else { throw HostError.code("REMOTE_FIXTURE_TEXT_INPUT_FOCUS") }
        let responderName = NSStringFromClass(type(of: panel.firstResponder!))
        input.insertText("Проверка пульта 123", replacementRange: NSRange(location: NSNotFound, length: 0))
        try await Task.sleep(for: .milliseconds(100))
        let value = try await web.evaluateJavaScript("document.getElementById('reply').value") as? String
        guard value == "Проверка пульта 123" else { throw HostError.code("REMOTE_FIXTURE_NATIVE_TEXT_INSERT") }
        remote.resize(width: 264, height: 64)
        try await Task.sleep(for: .milliseconds(100))
        let compact = panel.frame.size
        let compactWidth = try await web.evaluateJavaScript("window.innerWidth") as? Double
        guard abs(compact.width - 264) < 1, abs(compact.height - 64) < 1, compactWidth == 264 else { throw HostError.code("REMOTE_FIXTURE_COMPACT_GEOMETRY") }
        remote.resize(width: 420, height: 560)
        try await Task.sleep(for: .milliseconds(100))
        let expanded = panel.frame.size
        guard abs(expanded.width - 420) < 1, expanded.height <= 560, expanded.height >= 64 else { throw HostError.code("REMOTE_FIXTURE_EXPANDED_GEOMETRY") }
        remote.resize(width: 10000, height: 10000)
        let bounded = panel.frame.size, bounds = panel.screen?.visibleFrame ?? panel.frame
        guard bounded.width <= min(520, bounds.width), bounded.height <= min(900, bounds.height - 20),
              panel.frame.minY >= bounds.minY - 1, panel.frame.maxX <= bounds.maxX + 1 else { throw HostError.code("REMOTE_FIXTURE_BOUNDS") }
        return ["success": true, "platform": "MACOS", "nativeWindowClass": NSStringFromClass(type(of: panel)), "canBecomeKey": panel.canBecomeKey, "canBecomeMain": panel.canBecomeMain,
                "firstResponderClass": responderName, "nativeTextInput": true, "textareaValueMatched": true,
                "compact": ["width": compact.width, "height": compact.height], "expanded": ["width": expanded.width, "height": expanded.height], "oversizeClamped": ["width": bounded.width, "height": bounded.height],
                "networkUsed": false, "screenCaptured": false, "displaySettingsChanged": false, "loginItemsChanged": false, "keychainChanged": false]
    }
    func resize(width: Double, height: Double) {
        guard width.isFinite, height.isFinite, let panel else { return }
        let frame = panel.frame, bounds = panel.screen?.visibleFrame ?? frame
        let size = NSSize(width: min(max(width, 264), min(520, bounds.width)), height: min(max(height, 64), min(900, bounds.height - 20)))
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
        case "chooseSource", "publish", "stopCapture", "stopProjection", "pause", "ready", "capabilities", "screenRecordingSettings", "focusProjection": command?(value)
        default: break
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { applyTheme(); emit(["type": "capabilities", "platform": "MACOS", "nativeCapture": true, "theme": theme, "captureExclusion": ["supported": true, "enabled": true]]) }
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
            let panel = DisplayWindowPlacement.identification(frame: screen.frame, screen: screen, number: index + 1, name: screen.localizedName)
            panel.orderFrontRegardless(); overlays.append(panel)
        }
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in Task { @MainActor in self?.dismiss() } }
    }
    func dismiss() { timer?.invalidate(); timer = nil; overlays.forEach { $0.close() }; overlays.removeAll() }
}
