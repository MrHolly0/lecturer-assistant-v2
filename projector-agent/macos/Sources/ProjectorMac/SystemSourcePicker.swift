import AppKit
import ScreenCaptureKit

/// Window/application selection is authorized by the OS picker for this session.
/// Display selection stays on the explicit application-excluding capture path.
@MainActor final class SystemSourcePicker {
    private struct SelectedFilter: @unchecked Sendable { let filter: SCContentFilter }
    private final class Observer: NSObject, SCContentSharingPickerObserver, @unchecked Sendable {
        let id: UUID
        weak var owner: SystemSourcePicker?
        @MainActor init(id: UUID, owner: SystemSourcePicker) { self.id = id; self.owner = owner }
        func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
            guard stream == nil else { return }
            let selected = SelectedFilter(filter: filter)
            Task { @MainActor in owner?.complete(id: id, result: .success(selected)) }
        }
        func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
            guard stream == nil else { return }
            Task { @MainActor in owner?.complete(id: id, result: .success(nil)) }
        }
        func contentSharingPickerStartDidFailWithError(_ error: any Error) {
            Task { @MainActor in owner?.complete(id: id, result: .failure(HostError.code("CAPTURE_SYSTEM_PICKER_FAILED"))) }
        }
    }
    private struct Pending {
        let id: UUID
        let observer: Observer
        let continuation: CheckedContinuation<SelectedFilter?, any Error>
        let usesSystemPicker: Bool
    }
    private var pending: Pending?
    var isPresented: Bool { pending != nil }

    static func configuration(windowIDs: [Int]) -> SCContentSharingPickerConfiguration {
        var config = SCContentSharingPickerConfiguration()
        config.allowedPickerModes = [.singleWindow, .singleApplication]
        config.excludedBundleIDs = ["ru.university.lecturer-projector.host", "ru.university.lecturer-projector"]
        config.excludedWindowIDs = windowIDs.filter { $0 > 0 }
        config.allowsChangingSelectedContent = false
        return config
    }

    func select() async throws -> SCContentFilter? { try await select(present: nil) }
    private func select(present: ((Observer) -> Void)?) async throws -> SCContentFilter? {
        cancel()
        let selected: SelectedFilter? = try await withCheckedThrowingContinuation { continuation in
            let id = UUID()
            // Each presentation owns an observer; a late callback from a cancelled
            // presentation cannot approve a newer selection.
            let activeObserver = Observer(id: id, owner: self)
            pending = Pending(id: id, observer: activeObserver, continuation: continuation, usesSystemPicker: present == nil)
            if let present { present(activeObserver) }
            else {
                let picker = SCContentSharingPicker.shared
                picker.defaultConfiguration = Self.configuration(windowIDs: NSApp.windows.map(\.windowNumber))
                picker.maximumStreamCount = 1
                NSApp.activate(ignoringOtherApps: true)
                picker.add(activeObserver); picker.isActive = true; picker.present()
            }
        }
        return selected?.filter
    }
    func cancel() {
        guard let pending else { return }
        complete(id: pending.id, result: .success(nil))
    }
    private func complete(id: UUID, result: Result<SelectedFilter?, any Error>) {
        guard let current = pending, current.id == id else { return }
        pending = nil
        if current.usesSystemPicker { SCContentSharingPicker.shared.remove(current.observer) }
        // Keep the OS picker active for the lifetime of its scoped stream grant.
        // Stop/cancel explicitly deactivates it after the stream is closed.
        current.continuation.resume(with: result)
    }
    func deactivate() {
        cancel(); SCContentSharingPicker.shared.isActive = false
    }

    static func exerciseLifecycleFixture(filter: SCContentFilter, reply: @MainActor () async throws -> Void) async throws -> [String: Any] {
        let picker = SystemSourcePicker()
        var callback: Observer?
        let task = Task { try await picker.select(present: { callback = $0 }) === filter }
        try await Task.sleep(for: .milliseconds(30))
        let start = ProcessInfo.processInfo.systemUptime
        for _ in 0..<10 { try await reply(); try await Task.sleep(for: .milliseconds(20)) }
        guard picker.isPresented, let previous = callback else { throw HostError.code("SYSTEM_PICKER_NOT_PENDING") }
        picker.complete(id: previous.id, result: .success(SelectedFilter(filter: filter)))
        guard try await task.value else { throw HostError.code("SYSTEM_PICKER_FILTER_CHANGED") }
        let cancelled = Task { try await picker.select(present: { callback = $0 }) == nil }
        try await Task.sleep(for: .milliseconds(30)); picker.cancel(); picker.cancel()
        guard try await cancelled.value, !picker.isPresented else { throw HostError.code("SYSTEM_PICKER_CANCEL_FAILED") }
        let newer = Task { try await picker.select(present: { callback = $0 }) == nil }
        try await Task.sleep(for: .milliseconds(30))
        picker.complete(id: previous.id, result: .success(SelectedFilter(filter: filter)))
        guard picker.isPresented else { throw HostError.code("SYSTEM_PICKER_STALE_RESULT_ACCEPTED") }
        picker.cancel(); _ = try await newer.value
        let config = configuration(windowIDs: [12, 34, -1])
        guard config.allowedPickerModes == [.singleWindow, .singleApplication],
              !config.allowedPickerModes.contains(.singleDisplay), !config.allowsChangingSelectedContent,
              config.excludedWindowIDs == [12, 34], config.excludedBundleIDs.contains("ru.university.lecturer-projector.host") else { throw HostError.code("SYSTEM_PICKER_PRIVATE_CONFIGURATION_FAILED") }
        return ["windowAndApplicationOnly": true, "ownSourcesExcluded": true, "exactAuthorizedFilterPreserved": true,
                "cancelCompletesExactlyOnce": true, "staleSelectionRejected": true, "pendingSelectionAllowsNativeReplies": true,
                "fixtureReplySeconds": ProcessInfo.processInfo.systemUptime - start, "systemPickerPresented": false]
    }
}
