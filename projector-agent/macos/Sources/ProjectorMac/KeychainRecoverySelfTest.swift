import Foundation
import Security
import LocalAuthentication
import Darwin

@MainActor enum KeychainRecoverySelfTest {
    static func run(reportURL: URL) throws {
        var result: [String: Any]; var status: Int32 = 0
        guard let temporaryPath = realpath(FileManager.default.temporaryDirectory.path, nil) else { throw HostError.code("FIXTURE_TEMP_DIRECTORY_UNAVAILABLE") }; defer { free(temporaryPath) }
        let root = URL(fileURLWithPath: String(cString: temporaryPath)).appendingPathComponent(".projector-credential-recovery-" + UUID().uuidString + ".noindex")
        defer { try? FileManager.default.removeItem(at: root) }
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            result = try AppDelegate.exerciseSavedConnectionFixture(directory: root)
            let query = Keychain.silentQuery(account: "https://fixture.invalid/")
            guard query[kSecUseAuthenticationUI as String] as? String == kSecUseAuthenticationUIFail as String else { throw HostError.code("KEYCHAIN_MIGRATION_INTERACTION_ALLOWED") }
            var unsafeCopy = false
            _ = Keychain.readSilently(account: "https://fixture.invalid/") { value in
                guard let context = value[kSecUseAuthenticationContext as String] as? LAContext, context.interactionNotAllowed else {
                    unsafeCopy = true
                    return .unavailable(errSecAuthFailed)
                }
                return .missing
            }
            guard !unsafeCopy else { throw HostError.code("KEYCHAIN_MIGRATION_INTERACTION_ALLOWED") }
            guard case .missing = Keychain.decode(status: errSecItemNotFound, data: nil),
                  case .unavailable(errSecUserCanceled) = Keychain.decode(status: errSecUserCanceled, data: nil),
                  case .unavailable(errSecDecode) = Keychain.decode(status: errSecSuccess, data: Data([0xff])) else {
                throw HostError.code("KEYCHAIN_STATUS_CLASSIFICATION_FAILED")
            }
            let store = DeviceCredentialStore(directory: root), account = "https://fixture.invalid/"
            let identity = try InstallationIdentity.loadOrCreate(in: root)
            var reads = 0
            guard case .reconnect = try store.loadOrMigrate(account: account, legacyRead: { _ in reads += 1; return .unavailable(errSecInteractionNotAllowed) }), reads == 2 else { throw HostError.code("CREDENTIAL_RECOVERY_NOT_REPAIRABLE") }
            guard case .reconnect = try store.loadOrMigrate(account: account, legacyRead: { _ in reads += 1; return .missing }), reads == 2 else { throw HostError.code("CREDENTIAL_RECOVERY_RETRIED_KEYCHAIN") }
            let token = String(repeating: "c", count: 64)
            try store.store(token, account: account)
            let bootstrap = try CoordinatorBootstrap.make(origin: URL(string: account)!, name: "Fixture", platform: "MACOS_ARM64", deviceToken: nil, pairingCode: "ABCDEF123456", directory: root, previousToken: { candidate in
                if case .token(let old) = try store.loadOrMigrate(account: candidate, legacyRead: { _ in reads += 1; return .missing }) { return old }; return nil
            })
            guard bootstrap["installationId"] as? String == identity.uuidString.lowercased(), bootstrap["previousDeviceToken"] as? String == token, reads == 2 else { throw HostError.code("CREDENTIAL_RECOVERY_LOST_IDENTITY") }
            try store.disconnect(account: account)
            guard case .reconnect = try store.loadOrMigrate(account: account, legacyRead: { _ in reads += 1; return .token(token) }), reads == 2 else { throw HostError.code("CREDENTIAL_RECOVERY_UNPAIR_RESURRECTED") }
            result.merge(["success": true, "typedStatusPreserved": true,
                          "silentMigrationDoesNotRequestAuthentication": true, "blockedMigrationRequiresCode": true,
                          "blockedMigrationPreservesInstallationId": true, "blockedMigrationNotRetried": true,
                          "normalPairingUsesFileStore": true, "unpairDoesNotUseKeychain": true,
                          "interactiveKeychainUsed": false, "keychainUsed": false,
                          "userInstallationChanged": false, "networkUsed": false]) { _, value in value }
        } catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
        catch { result = ["success": false, "code": "KEYCHAIN_RECOVERY_FIXTURE_FAILED"]; status = 1 }
        try? FileManager.default.removeItem(at: root)
        try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
        if status != 0 { exit(status) }
    }
}
