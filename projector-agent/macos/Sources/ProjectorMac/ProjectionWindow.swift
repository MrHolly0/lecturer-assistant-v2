import AppKit
import WebKit

@MainActor final class ProjectionWindow: NSObject, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var allowedURL: URL?
    private var web: WKWebView?
    func test(screenID: String, code: String) throws {
        let screen = try target(screenID)
        neutralize()
        let window = createWindow(screen)
        let field = NSTextField(labelWithString: "Проверка проектора\n\n" + code + "\n\nПодтвердите этот код на компьютере преподавателя.")
        field.font = NSFont.systemFont(ofSize: 32, weight: .medium)
        field.alignment = .center; field.textColor = .white; field.frame = window.contentView!.bounds.insetBy(dx: 48, dy: 48)
        field.autoresizingMask = [.width, .height]
        window.contentView!.addSubview(field)
        window.orderFrontRegardless(); self.window = window
    }
    func show(screenID: String, url: URL, origin: URL) throws {
        guard Self.allowed(url, origin: origin) else { throw HostError.code("PUBLIC_URL_REJECTED") }
        let screen = try target(screenID)
        neutralize(); allowedURL = url
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent() // Never inherit staff cookies or the normal browser's session.
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        let window = createWindow(screen)
        web.frame = window.contentView!.bounds; web.autoresizingMask = [.width, .height]
        window.contentView!.addSubview(web); self.web = web; self.window = window
        web.load(URLRequest(url: url)); window.orderFrontRegardless()
    }
    func neutralize() {
        web?.stopLoading(); web?.loadHTMLString("<html><body style='margin:0;background:#111;color:white;display:grid;place-items:center;height:100vh;font:28px system-ui'>Показ остановлен</body></html>", baseURL: nil)
        web?.removeFromSuperview(); web = nil; allowedURL = nil
        guard let window else { return }
        window.contentView?.subviews.forEach { $0.removeFromSuperview() }
        let field = NSTextField(labelWithString: "Показ остановлен")
        field.textColor = .white; field.alignment = .center; field.font = .systemFont(ofSize: 32)
        field.frame = window.contentView!.bounds.insetBy(dx: 48, dy: 48); field.autoresizingMask = [.width, .height]
        window.contentView?.addSubview(field)
    }
    func close() { neutralize(); window?.close(); window = nil }
    private func target(_ id: String) throws -> NSScreen {
        guard let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { DisplayController.screenID($0.uint32Value) } == id }),
              let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              number.uint32Value != CGMainDisplayID(), CGDisplayMirrorsDisplay(number.uint32Value) == 0 else {
            throw HostError.code("TARGET_NOT_INDEPENDENT_EXTERNAL")
        }
        return screen
    }
    private func createWindow(_ screen: NSScreen) -> NSWindow {
        let window = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
        window.backgroundColor = .black; window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .stationary]
        window.isReleasedWhenClosed = false
        return window
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
