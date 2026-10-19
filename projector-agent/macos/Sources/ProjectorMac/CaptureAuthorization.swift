import Foundation

/// Injectable permission checks keep isolated tests away from the user's TCC database.
@MainActor enum CaptureAuthorization {
    static func request(preflight: () -> Bool, activate: () -> Void, prompt: () -> Bool) -> Bool {
        if preflight() { return true }
        activate()
        return prompt() || preflight()
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
