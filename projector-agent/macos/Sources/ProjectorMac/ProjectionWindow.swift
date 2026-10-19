import AppKit
import WebKit

@MainActor private final class HiddenProjectionFixtureWindow: NSWindow {
    var closeCalls = 0
    override func close() { closeCalls += 1; super.close() }
}

@MainActor final class ProjectionWindow: NSObject, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var allowedURL: URL?
    private var web: WKWebView?
    func test(screenID: String, code: String) throws {
        let screen = try target(screenID)
        let window = replaceWindow(createWindow(screen))
        let field = NSTextField(labelWithString: "Проверка проектора\n\n" + code + "\n\nПодтвердите этот код на компьютере преподавателя.")
        field.font = NSFont.systemFont(ofSize: 32, weight: .medium)
        field.alignment = .center; field.textColor = .white; field.frame = window.contentView!.bounds.insetBy(dx: 48, dy: 48)
        field.autoresizingMask = [.width, .height]
        window.contentView!.addSubview(field)
        window.orderFrontRegardless()
    }
    func show(screenID: String, url: URL, origin: URL) throws {
        guard Self.allowed(url, origin: origin) else { throw HostError.code("PUBLIC_URL_REJECTED") }
        let screen = try target(screenID)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent() // Never inherit staff cookies or the normal browser's session.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = false
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        let window = replaceWindow(createWindow(screen)); allowedURL = url
        web.frame = window.contentView!.bounds; web.autoresizingMask = [.width, .height]
        window.contentView!.addSubview(web); self.web = web
        web.load(URLRequest(url: url)); window.orderFrontRegardless()
    }
    func neutralize() {
        close()
    }
    func close() {
        web?.stopLoading()
        web?.removeFromSuperview(); web = nil; allowedURL = nil
        let previous = window; window = nil
        previous?.orderOut(nil); previous?.close()
    }
    private func replaceWindow(_ replacement: NSWindow) -> NSWindow { close(); window = replacement; return replacement }
    static func exerciseHiddenLifecycleFixture() throws -> [String: Any] {
        let projection = ProjectionWindow()
        let first = HiddenProjectionFixtureWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 180), styleMask: [.borderless], backing: .buffered, defer: false)
        let second = HiddenProjectionFixtureWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 180), styleMask: [.borderless], backing: .buffered, defer: false)
        first.isReleasedWhenClosed = false; second.isReleasedWhenClosed = false
        defer { projection.close(); if first.closeCalls == 0 { first.close() }; if second.closeCalls == 0 { second.close() } }
        _ = projection.replaceWindow(first)
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: first.contentView!.bounds, configuration: configuration)
        first.contentView?.addSubview(view); projection.web = view; projection.allowedURL = URL(string: "https://fixture.invalid/")
        _ = projection.replaceWindow(second)
        guard first.closeCalls == 1, view.superview == nil, projection.web == nil, projection.allowedURL == nil,
              projection.window === second, !first.isVisible, !second.isVisible else { throw HostError.code("WORKSPACE_ORPHAN_PUBLIC_WINDOW") }
        projection.neutralize(); projection.close()
        guard second.closeCalls == 1, projection.window == nil, projection.web == nil, !second.isVisible else { throw HostError.code("WORKSPACE_PUBLIC_STOP_DID_NOT_CLOSE") }
        return ["replacedPublicWindowClosed": true, "publicStopClosesWindow": true, "publicWebDetached": true, "allWindowsHidden": true]
    }
    func focus() { window?.orderFrontRegardless() }
    private func target(_ id: String) throws -> NSScreen {
        guard let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { DisplayController.screenID($0.uint32Value) } == id }),
              let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              number.uint32Value != CGMainDisplayID(), CGDisplayMirrorsDisplay(number.uint32Value) == 0 else {
            throw HostError.code("TARGET_NOT_INDEPENDENT_EXTERNAL")
        }
        return screen
    }
    private func createWindow(_ screen: NSScreen) -> NSWindow {
        DisplayWindowPlacement.projection(frame: screen.frame, screen: screen)
    }
    static func allowed(_ candidate: URL, origin: URL) -> Bool {
        guard candidate.scheme == "https", candidate.scheme == origin.scheme, candidate.host == origin.host,
              candidate.port == origin.port, candidate.user == nil, candidate.password == nil, candidate.path == "/",
              candidate.query == nil, let fragment = candidate.fragment, fragment.hasPrefix("/projection/") else { return false }
        let pieces = String(fragment.dropFirst("/projection/".count)).split(separator: "?", omittingEmptySubsequences: false)
        guard pieces.count <= 2 else { return false }
        if pieces.count == 2 {
            guard pieces[1].hasPrefix("projectionViewToken=") else { return false }
            let token = pieces[1].dropFirst("projectionViewToken=".count)
            guard token.count == 64 && token.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return false }
        }
        let code = String(pieces[0])
        return (4...32).contains(code.count) && code.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == false { decisionHandler(.cancel); return }
        guard let url = action.request.url, let expected = allowedURL,
              url == expected, action.targetFrame != nil else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) { completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) { completionHandler(false) }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) { completionHandler(nil) }
}
