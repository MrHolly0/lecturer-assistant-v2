import AppKit
import Foundation

struct WorkspaceOpened: Sendable { let pid: Int32; let bundlePath: String }

@MainActor enum WorkspaceHandoff {
    static func open(target: URL, arguments: [String] = [], urls: [URL] = []) async throws -> WorkspaceOpened {
        let expectedIdentity = try Installation.codeIdentity(target)
        let result = try await withCheckedThrowingContinuation { continuation in
            let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = false
            configuration.allowsRunningApplicationSubstitution = false; configuration.createsNewApplicationInstance = true
            configuration.arguments = arguments
            if urls.isEmpty { NSWorkspace.shared.openApplication(at: target, configuration: configuration, completionHandler: receiver(continuation)) }
            else { NSWorkspace.shared.open(urls, withApplicationAt: target, configuration: configuration, completionHandler: receiver(continuation)) }
        }
        // A supported launch can still be translocated. Verify the approved executable identity,
        // never guess the original location or remove its quarantine.
        guard try Installation.codeIdentity(URL(fileURLWithPath: result.bundlePath)) == expectedIdentity else { throw BootstrapFailure.code("START_INSTALLED_APPLICATION_WRONG_IDENTITY") }
        return result
    }
    // NSWorkspace invokes completion on a concurrent queue. Keeping creation here explicitly
    // nonisolated avoids inheriting @MainActor from the installer and trapping on older SDKs.
    nonisolated private static func receiver(_ continuation: CheckedContinuation<WorkspaceOpened, any Error>) -> @Sendable (NSRunningApplication?, (any Error)?) -> Void {
        { application, error in
            guard error == nil, let application, let path = application.bundleURL?.standardizedFileURL.path else { continuation.resume(throwing: BootstrapFailure.code("START_INSTALLED_APPLICATION_FAILED")); return }
            continuation.resume(returning: WorkspaceOpened(pid: application.processIdentifier, bundlePath: path))
        }
    }
    static func backgroundCallbackFixture() async -> Bool {
        do {
            let _: WorkspaceOpened = try await withCheckedThrowingContinuation { continuation in
                let completion = receiver(continuation)
                DispatchQueue.global().async { completion(nil, NSError(domain: "LocalHandoffFixture", code: 1)) }
            }
            return false
        } catch { return true }
    }
}
