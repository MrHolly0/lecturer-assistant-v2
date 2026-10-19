import AppKit

/// A capture dialog must yield the main actor so native command replies renew the output lease.
@MainActor final class CaptureDialog {
    private struct Pending {
        let id: UUID
        let alert: NSAlert
        let parent: NSWindow
        let continuation: CheckedContinuation<NSApplication.ModalResponse, Never>
        let closeObserver: NSObjectProtocol
    }
    private var pending: Pending?
    var isPresented: Bool { pending != nil }

    func present(_ alert: NSAlert, for parent: NSWindow) async -> NSApplication.ModalResponse {
        cancel()
        return await withCheckedContinuation { continuation in
            let id = UUID()
            let observer = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: parent, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.complete(id: id, response: .cancel) }
            }
            pending = Pending(id: id, alert: alert, parent: parent, continuation: continuation, closeObserver: observer)
            alert.beginSheetModal(for: parent, completionHandler: Self.completion(for: self, id: id))
        }
    }
    func cancel() {
        guard let pending else { return }
        complete(id: pending.id, response: .cancel)
    }
    private func complete(id: UUID, response: NSApplication.ModalResponse) {
        guard let active = pending, active.id == id else { return }
        pending = nil
        NotificationCenter.default.removeObserver(active.closeObserver)
        if active.alert.window.sheetParent != nil { active.parent.endSheet(active.alert.window, returnCode: response) }
        active.alert.window.orderOut(nil); active.alert.window.close()
        active.continuation.resume(returning: response)
    }
    nonisolated private static func completion(for dialog: CaptureDialog, id: UUID) -> @Sendable (NSApplication.ModalResponse) -> Void {
        { [weak dialog] response in Task { @MainActor in dialog?.complete(id: id, response: response) } }
    }
}
