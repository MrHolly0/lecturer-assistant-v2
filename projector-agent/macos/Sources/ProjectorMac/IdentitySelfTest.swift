import Foundation
import Darwin

enum IdentitySelfTest {
    static func run(reportURL: URL) throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent(".projector-identity-" + UUID().uuidString + ".noindex", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var report: [String: Any]
        var status: Int32 = 0
        do {
            report = try exercise(root: root)
        } catch HostError.code(let code) { report = ["success": false, "code": code]; status = 1 }
        catch { report = ["success": false, "code": "IDENTITY_FIXTURE_FAILED"]; status = 1 }
        try FileManager.default.removeItem(at: root)
        report["fixtureCleaned"] = !FileManager.default.fileExists(atPath: root.path)
        report["keychainUsed"] = false; report["userInstallationChanged"] = false
        report["networkUsed"] = false; report["displaySettingsChanged"] = false
        try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted])
        try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
        if status != 0 { exit(status) }
    }

    private static func exercise(root: URL) throws -> [String: Any] {
        let support = root.appendingPathComponent("Application Support/LecturerProjector", isDirectory: true)
        let first = try InstallationIdentity.loadOrCreate(in: support)
        let version = support.appendingPathComponent("install/versions/0.2.4", isDirectory: true)
        try FileManager.default.createDirectory(at: version, withIntermediateDirectories: true)
        try FileManager.default.removeItem(at: support.appendingPathComponent("install"))
        try FileManager.default.createDirectory(at: support.appendingPathComponent("install/versions/0.2.5"), withIntermediateDirectories: true)
        let second = try InstallationIdentity.loadOrCreate(in: support)
        guard first == second else { throw HostError.code("IDENTITY_CHANGED_AFTER_UPDATE") }
        let savedOrigin = support.appendingPathComponent("origin.txt")
        try "https://school.example/".write(to: savedOrigin, atomically: true, encoding: .utf8)
        try FileManager.default.removeItem(at: savedOrigin)
        guard try InstallationIdentity.loadOrCreate(in: support) == first else { throw HostError.code("IDENTITY_CHANGED_AFTER_UNPAIR") }
        let different = try InstallationIdentity.loadOrCreate(in: root.appendingPathComponent("other-user/LecturerProjector"))
        guard first != different else { throw HostError.code("IDENTITY_SHARED_BETWEEN_ROOTS") }

        for (index, text) in ["not-a-uuid\n", String(repeating: "z", count: 36), "00000000-0000-0000-0000-000000000000"].enumerated() {
            let corrupt = root.appendingPathComponent("corrupt-\(index)", isDirectory: true)
            try FileManager.default.createDirectory(at: corrupt, withIntermediateDirectories: true)
            let invalid = Data(text.utf8), invalidFile = corrupt.appendingPathComponent(InstallationIdentity.filename)
            try invalid.write(to: invalidFile)
            do { _ = try InstallationIdentity.loadOrCreate(in: corrupt); throw HostError.code("IDENTITY_CORRUPTION_IGNORED") }
            catch HostError.code(let code) where code == "INSTALLATION_ID_INVALID" { }
            guard try Data(contentsOf: invalidFile) == invalid else { throw HostError.code("IDENTITY_CORRUPTION_OVERWRITTEN") }
        }

        let concurrentRoot = root.appendingPathComponent("concurrent", isDirectory: true)
        let results = ConcurrentIdentityResults()
        DispatchQueue.concurrentPerform(iterations: 24) { _ in
            do { results.append(try InstallationIdentity.loadOrCreate(in: concurrentRoot)) }
            catch { results.fail() }
        }
        guard results.succeeded(count: 24) else { throw HostError.code("IDENTITY_CONCURRENT_CREATION_FAILED") }
        let permissions = try FileManager.default.attributesOfItem(atPath: support.appendingPathComponent(InstallationIdentity.filename).path)[.posixPermissions] as? NSNumber
        guard permissions?.intValue == 0o600 else { throw HostError.code("IDENTITY_FILE_NOT_PRIVATE") }

        let site = URL(string: "https://school.example/")!, other = URL(string: "https://other.example/")!
        var lookedUp: [String] = []
        let pairing = try CoordinatorBootstrap.make(origin: site, name: "Fixture Mac", platform: "MACOS_ARM64", deviceToken: nil,
                                                   pairingCode: "ABCD1234EFGH", directory: support) { account in
            lookedUp.append(account); return account == site.absoluteString ? "fixture-previous-token" : nil
        }
        guard lookedUp == [site.absoluteString], pairing["previousDeviceToken"] as? String == "fixture-previous-token",
              pairing["installationId"] as? String == first.uuidString.lowercased(), pairing["deviceToken"] == nil else {
            throw HostError.code("IDENTITY_PAIRING_FIELDS_MISSING")
        }
        let otherPairing = try CoordinatorBootstrap.make(origin: other, name: "Fixture Mac", platform: "MACOS_ARM64", deviceToken: nil,
                                                        pairingCode: "ABCD1234EFGH", directory: support) { account in
            lookedUp.append(account); return account == site.absoluteString ? "fixture-previous-token" : nil
        }
        guard lookedUp == [site.absoluteString, other.absoluteString, "https://other.example"], otherPairing["previousDeviceToken"] == nil,
              otherPairing["installationId"] as? String == pairing["installationId"] as? String else {
            throw HostError.code("IDENTITY_TOKEN_LEAKED_TO_OTHER_ORIGIN")
        }
        var aliasesLookedUp: [String] = []
        let legacy = try CoordinatorBootstrap.make(origin: site, name: "Fixture Mac", platform: "MACOS_ARM64", deviceToken: nil,
                                                  pairingCode: "ABCD1234EFGH", directory: support) { account in
            aliasesLookedUp.append(account); return account == "https://school.example" ? "fixture-legacy-token" : nil
        }
        guard aliasesLookedUp == [site.absoluteString, "https://school.example"],
              legacy["previousDeviceToken"] as? String == "fixture-legacy-token" else { throw HostError.code("IDENTITY_ROOT_SLASH_ALIAS_LOST") }
        let unusedRoot = root.appendingPathComponent("resume-must-not-create", isDirectory: true)
        let resume = try CoordinatorBootstrap.make(origin: site, name: "Fixture Mac", platform: "MACOS_ARM64", deviceToken: "fixture-resume-token",
                                                  pairingCode: nil, directory: unusedRoot) { _ in lookedUp.append("unexpected"); return "invalid" }
        guard resume["deviceToken"] as? String == "fixture-resume-token", resume["installationId"] == nil,
              resume["previousDeviceToken"] == nil, lookedUp.count == 3,
              !FileManager.default.fileExists(atPath: unusedRoot.path) else { throw HostError.code("IDENTITY_RESUME_CHANGED") }
        return ["success": true, "stableAcrossStartsAndUpdates": true, "differentRootsHaveDifferentIDs": true,
                "corruptIDRejectedWithoutReplacement": true, "zeroUUIDRejected": true, "concurrentCreationStable": true, "filePrivate": true,
                "pairingIncludesInstallationID": true, "previousTokenUsesExactOriginOnly": true,
                "sameOriginRootSlashAliasSupported": true, "resumeUnchanged": true,
                "identityOutsideVersionedInstall": true, "localUnpairPreservesIdentity": true]
    }
}

private final class ConcurrentIdentityResults: @unchecked Sendable {
    private let lock = NSLock()
    private var ids: [UUID] = []
    private var failed = false
    func append(_ id: UUID) { lock.lock(); defer { lock.unlock() }; ids.append(id) }
    func fail() { lock.lock(); defer { lock.unlock() }; failed = true }
    func succeeded(count: Int) -> Bool { lock.lock(); defer { lock.unlock() }; return !failed && ids.count == count && Set(ids).count == 1 }
}
