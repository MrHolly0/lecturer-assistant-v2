import Foundation
import Security
import Darwin

@MainActor enum KeychainRecoverySelfTest {
    static func run(reportURL: URL) throws {
        var result: [String: Any]; var status: Int32 = 0
        do {
            result = try AppDelegate.exerciseSavedConnectionFixture()
            guard case .missing = Keychain.decode(status: errSecItemNotFound, data: nil),
                  case .unavailable(errSecUserCanceled) = Keychain.decode(status: errSecUserCanceled, data: nil),
                  case .unavailable(errSecDecode) = Keychain.decode(status: errSecSuccess, data: Data([0xff])) else {
                throw HostError.code("KEYCHAIN_STATUS_CLASSIFICATION_FAILED")
            }
            var stored = "previous-fixture-token", updates = 0, additions = 0
            do {
                try Keychain.store("new-fixture-token", account: "https://fixture.invalid/", update: { _, _ in updates += 1; return errSecAuthFailed }, add: { _ in additions += 1; return errSecSuccess })
                throw HostError.code("KEYCHAIN_DENIED_UPDATE_ACCEPTED")
            } catch HostError.code(let code) where code == "KEYCHAIN_WRITE_FAILED" { }
            guard stored == "previous-fixture-token", updates == 1, additions == 0 else { throw HostError.code("KEYCHAIN_DENIED_UPDATE_REMOVED_PREVIOUS") }
            try Keychain.store("new-fixture-token", account: "https://fixture.invalid/", update: { _, value in
                updates += 1; stored = String(decoding: value[kSecValueData as String] as! Data, as: UTF8.self); return errSecSuccess
            }, add: { _ in additions += 1; return errSecSuccess })
            guard stored == "new-fixture-token", updates == 2, additions == 0 else { throw HostError.code("KEYCHAIN_EXISTING_ITEM_RECREATED") }
            try Keychain.store("added-fixture-token", account: "https://fixture.invalid/", update: { _, _ in updates += 1; return errSecItemNotFound }, add: { value in
                additions += 1; stored = String(decoding: value[kSecValueData as String] as! Data, as: UTF8.self); return errSecSuccess
            })
            guard stored == "added-fixture-token", additions == 1 else { throw HostError.code("KEYCHAIN_MISSING_ITEM_NOT_ADDED") }
            result.merge(["success": true, "typedStatusPreserved": true, "deniedUpdatePreservesPrevious": true,
                          "existingItemUpdatedWithoutDelete": true, "addOnlyWhenMissing": true,
                          "keychainUsed": false, "userInstallationChanged": false, "networkUsed": false]) { _, value in value }
        } catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
        catch { result = ["success": false, "code": "KEYCHAIN_RECOVERY_FIXTURE_FAILED"]; status = 1 }
        try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
        if status != 0 { exit(status) }
    }
}
