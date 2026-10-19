import Foundation

@MainActor final class DisplayCaptureAuthorization {
    private var requested = false
    func request(preflight: () -> Bool, activate: () -> Void, prompt: () async -> Bool) async -> Bool {
        if preflight() { return true }
        guard !requested else { return false }
        requested = true
        return await CaptureAuthorization.request(preflight: preflight, activate: activate, prompt: prompt)
    }
}

/// Injectable permission checks keep isolated tests away from the user's TCC database.
@MainActor enum CaptureAuthorization {
    static func request(preflight: () -> Bool, activate: () -> Void, prompt: () async -> Bool) async -> Bool {
        if preflight() { return true }
        activate()
        return await prompt() || preflight()
    }
    nonisolated static func offMainPrompt(_ prompt: @escaping @Sendable () -> Bool) async -> Bool {
        await Task.detached(priority: .userInitiated) { prompt() }.value
    }
    static func waitForGrant(attempts: Int, preflight: () -> Bool, cancelled: () -> Bool, pause: () async throws -> Void) async -> Bool {
        for _ in 0..<attempts {
            if cancelled() { return false }
            if preflight() { return true }
            do { try await pause() } catch { return false }
        }
        return !cancelled() && preflight()
    }
}
