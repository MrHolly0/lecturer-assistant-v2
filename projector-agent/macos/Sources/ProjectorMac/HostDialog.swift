import AppKit

/// Native connection/status dialogs remain interactive without running a nested
/// modal loop inside a main-actor task. Command replies can continue meanwhile.
@MainActor final class HostDialog: NSObject, NSWindowDelegate {
    private var alert: NSAlert?
    private var continuation: CheckedContinuation<NSApplication.ModalResponse, Never>?
    var prepareWindow: ((NSAlert) -> Void)?
    var isPresented: Bool { alert != nil }
    func present(_ alert: NSAlert) async -> NSApplication.ModalResponse {
        cancel()
        return await withCheckedContinuation { continuation in
            self.alert = alert; self.continuation = continuation
            alert.layout()
            for (index, button) in alert.buttons.enumerated() {
                button.tag = NSApplication.ModalResponse.alertFirstButtonReturn.rawValue + index
                button.target = self; button.action = #selector(selected(_:))
            }
            alert.window.delegate = self
            prepareWindow?(alert)
            alert.window.makeKeyAndOrderFront(nil)
        }
    }
    func cancel() { finish(.cancel) }
    func focus() {
        guard let alert else { return }
        NSApp.activate(ignoringOtherApps: true); alert.window.makeKeyAndOrderFront(nil)
    }
    static func presentSavePanel(_ panel: NSSavePanel) async -> NSApplication.ModalResponse {
        await withCheckedContinuation { panel.begin(completionHandler: saveCompletion($0)) }
    }
    nonisolated private static func saveCompletion(_ continuation: CheckedContinuation<NSApplication.ModalResponse, Never>) -> @Sendable (NSApplication.ModalResponse) -> Void {
        { response in continuation.resume(returning: response) }
    }
    @objc private func selected(_ sender: NSButton) { finish(NSApplication.ModalResponse(rawValue: sender.tag)) }
    func windowWillClose(_ notification: Notification) { finish(.cancel) }
    private func finish(_ response: NSApplication.ModalResponse) {
        guard let alert else { return }
        self.alert = nil
        let active = continuation; continuation = nil
        alert.window.delegate = nil; alert.window.orderOut(nil); alert.window.close()
        active?.resume(returning: response)
    }
}
