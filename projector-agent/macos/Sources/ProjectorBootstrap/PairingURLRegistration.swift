import AppKit
import CoreServices
import Foundation

@MainActor enum PairingURLRegistration {
    static let scheme = "lecturer-projector"

    static func ensureInstalled(_ target: URL) async throws {
        guard Installation.isStable(target), Bundle(url: target)?.bundleIdentifier == Installation.identifier,
              let approved = try Installation.installedMatch(runningBundle: target),
              approved.path == target.standardizedFileURL.path else { throw BootstrapFailure.code("PAIR_HANDLER_UNSAFE_TARGET") }
        try await select(target: approved, scheme: scheme)
    }

    // Register only the canonical app. The distributable installer has a distinct
    // bundle ID and no scheme claims; identical-ID copies cannot be selected reliably.
    static func select(target: URL, scheme: String) async throws {
        _ = try Installation.codeIdentity(target)
        let declared = (Bundle(url: target)?.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])?
            .flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] } ?? []
        guard declared.contains(scheme), scheme == Self.scheme || scheme.hasPrefix("lecture-fixture-") else { throw BootstrapFailure.code("PAIR_HANDLER_UNDECLARED_SCHEME") }
        let probe = URL(string: scheme + "://pair")!
        if NSWorkspace.shared.urlForApplication(toOpen: probe)?.standardizedFileURL.path == target.standardizedFileURL.path { return }
        guard LSRegisterURL(target as CFURL, true) == noErr else { throw BootstrapFailure.code("PAIR_HANDLER_REGISTRATION_FAILED") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            NSWorkspace.shared.setDefaultApplication(at: target, toOpenURLsWithScheme: scheme, completion: receiver(continuation))
        }
        let deadline = Date().addingTimeInterval(3)
        while NSWorkspace.shared.urlForApplication(toOpen: probe)?.standardizedFileURL.path != target.standardizedFileURL.path, Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        guard NSWorkspace.shared.urlForApplication(toOpen: probe)?.standardizedFileURL.path == target.standardizedFileURL.path else { throw BootstrapFailure.code("PAIR_HANDLER_SELECTION_UNVERIFIED") }
    }

    nonisolated private static func receiver(_ continuation: CheckedContinuation<Void, any Error>) -> @Sendable ((any Error)?) -> Void {
        { error in
            if error != nil { continuation.resume(throwing: BootstrapFailure.code("PAIR_HANDLER_SELECTION_DENIED")) }
            else { continuation.resume() }
        }
    }
}
