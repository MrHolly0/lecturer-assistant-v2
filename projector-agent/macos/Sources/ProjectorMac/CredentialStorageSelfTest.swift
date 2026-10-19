import Foundation
import Security
import Darwin

enum CredentialStorageSelfTest {
    private final class Failures: @unchecked Sendable {
        private let lock = NSLock()
        private var failed = false
        func mark() { lock.lock(); failed = true; lock.unlock() }
        var any: Bool { lock.lock(); defer { lock.unlock() }; return failed }
    }

    static func run(reportURL: URL) throws {
        var result: [String: Any], exitCode: Int32 = 0
        guard let temporaryPath = realpath(FileManager.default.temporaryDirectory.path, nil) else { throw HostError.code("FIXTURE_TEMP_DIRECTORY_UNAVAILABLE") }; defer { free(temporaryPath) }
        let root = URL(fileURLWithPath: String(cString: temporaryPath)).appendingPathComponent(".projector-credentials-" + UUID().uuidString + ".noindex")
        defer { try? FileManager.default.removeItem(at: root) }
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            result = try exercise(root: root)
            result.merge(["success": true, "keychainUsed": false, "userInstallationChanged": false, "networkUsed": false]) { _, new in new }
        } catch HostError.code(let code) { result = ["success": false, "code": code]; exitCode = 1 }
        catch { result = ["success": false, "code": "DEVICE_CREDENTIAL_FIXTURE_FAILED"]; exitCode = 1 }
        try? FileManager.default.removeItem(at: root)
        try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
        try data.write(to: reportURL, options: .atomic); FileHandle.standardOutput.write(data + Data([10]))
        if exitCode != 0 { exit(exitCode) }
    }

    static func exercise(root: URL) throws -> [String: Any] {
        let account = "https://school.example/", token = String(repeating: "a", count: 64), newer = String(repeating: "b", count: 64)
        let store = DeviceCredentialStore(directory: root)
        try store.store(token, account: account)
        let folder = root.appendingPathComponent(DeviceCredentialStore.folder), file = folder.appendingPathComponent(try DeviceCredentialStore.filename(for: account))
        var metadata = stat()
        guard lstat(folder.path, &metadata) == 0 else { throw HostError.code("FIXTURE_DIRECTORY_MISSING") }
        try DeviceCredentialStore.validatePrivate(metadata, directory: true)
        guard lstat(file.path, &metadata) == 0 else { throw HostError.code("FIXTURE_FILE_MISSING") }
        try DeviceCredentialStore.validatePrivate(metadata, directory: false)
        var foreign = metadata; foreign.st_uid = metadata.st_uid == 0 ? 1 : 0
        try rejected { try DeviceCredentialStore.validatePrivate(foreign, directory: false) }
        try store.store(newer, account: account)
        try requireToken(store, account: account, expected: newer)
        try rejected { try store.store(token, account: account, beforePublish: { throw HostError.code("FIXTURE_INTERRUPTED_WRITE") }) }
        try requireToken(store, account: account, expected: newer)

        // Readers do not take the store lock: a broken write-in-place would expose
        // a truncated or partial JSON record during this real concurrent rotation.
        let failures = Failures()
        DispatchQueue.concurrentPerform(iterations: 64) { index in
            do {
                if index.isMultiple(of: 2) {
                    try store.store(String(format: "%064x", index + 1), account: account)
                } else {
                    for _ in 0..<20 {
                        let bytes = try Data(contentsOf: file)
                        guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                              let valueToken = value["token"] as? String, DeviceCredentialStore.validToken(valueToken) else {
                            failures.mark(); return
                        }
                    }
                }
            } catch { failures.mark() }
        }
        guard !failures.any else { throw HostError.code("FIXTURE_ATOMIC_ROTATION_FAILED") }
        try store.store(token, account: account)
        var legacyReads = 0
        guard case .reconnect = try store.loadOrMigrate(account: "https://other.example/", legacyRead: { _ in legacyReads += 1; return .missing }), legacyReads == 2 else { throw HostError.code("FIXTURE_ORIGIN_NOT_ISOLATED") }
        try requireToken(store, account: "https://SCHOOL.example:443", expected: token)
        try rejected { _ = try store.loadOrMigrate(account: "http://school.example/", legacyRead: { _ in throwUnexpectedLegacy() }) }
        try rejected { _ = try store.loadOrMigrate(account: "https://school.example/path", legacyRead: { _ in throwUnexpectedLegacy() }) }

        guard chmod(file.path, 0o644) == 0 else { throw HostError.code("FIXTURE_CHMOD_FAILED") }
        try rejected { try requireToken(store, account: account, expected: token) }
        guard chmod(file.path, 0o600) == 0 else { throw HostError.code("FIXTURE_CHMOD_FAILED") }
        guard chmod(folder.path, 0o755) == 0 else { throw HostError.code("FIXTURE_CHMOD_FAILED") }
        try rejected { try requireToken(store, account: account, expected: token) }
        guard chmod(folder.path, 0o700) == 0 else { throw HostError.code("FIXTURE_CHMOD_FAILED") }
        let aclCommand = Process(); aclCommand.executableURL = URL(fileURLWithPath: "/bin/chmod")
        guard let user = getpwuid(getuid()) else { throw HostError.code("FIXTURE_USER_NOT_FOUND") }
        aclCommand.arguments = ["+a", "user:" + String(cString: user.pointee.pw_name) + " allow read", file.path]
        aclCommand.standardOutput = FileHandle.nullDevice; aclCommand.standardError = FileHandle.nullDevice
        try aclCommand.run(); aclCommand.waitUntilExit()
        guard aclCommand.terminationStatus == 0 else { throw HostError.code("FIXTURE_ACL_CREATE_FAILED") }
        try rejected { try requireToken(store, account: account, expected: token) }
        try FileManager.default.removeItem(at: file)
        let unrelated = root.appendingPathComponent("unrelated"); try Data("unchanged".utf8).write(to: unrelated)
        guard symlink(unrelated.path, file.path) == 0 else { throw HostError.code("FIXTURE_LINK_FAILED") }
        try rejected { try store.store(token, account: account) }
        guard try Data(contentsOf: unrelated) == Data("unchanged".utf8) else { throw HostError.code("FIXTURE_SYMLINK_FOLLOWED") }
        try FileManager.default.removeItem(at: file)
        try store.store(token, account: account)
        let hardLink = root.appendingPathComponent("hardlink")
        guard link(file.path, hardLink.path) == 0 else { throw HostError.code("FIXTURE_LINK_FAILED") }
        try rejected { try requireToken(store, account: account, expected: token) }
        try FileManager.default.removeItem(at: hardLink)
        let malformed = Data("{\"schema\":1,\"state\":\"connected\",\"token\":\"wrong\"}".utf8)
        try malformed.write(to: file); guard chmod(file.path, 0o600) == 0 else { throw HostError.code("FIXTURE_CHMOD_FAILED") }
        try rejected { _ = try store.loadOrMigrate(account: account, legacyRead: { _ in throwUnexpectedLegacy() }) }
        try FileManager.default.removeItem(at: file)

        let linkedRoot = root.appendingPathComponent("linked-root")
        guard symlink(root.path, linkedRoot.path) == 0 else { throw HostError.code("FIXTURE_LINK_FAILED") }
        try rejected { try DeviceCredentialStore(directory: linkedRoot).store(token, account: account) }
        let redirectedBase = root.appendingPathComponent("redirected")
        try FileManager.default.createDirectory(at: redirectedBase, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        guard symlink(folder.path, redirectedBase.appendingPathComponent(DeviceCredentialStore.folder).path) == 0 else { throw HostError.code("FIXTURE_LINK_FAILED") }
        try rejected { try DeviceCredentialStore(directory: redirectedBase).store(token, account: account) }

        var migratedReads: [String] = []
        try requireToken(store, account: account, expected: token, legacyRead: { candidate in
            migratedReads.append(candidate)
            return candidate.hasSuffix("/") ? .missing : .token(token)
        })
        guard migratedReads == [account, String(account.dropLast())] else { throw HostError.code("FIXTURE_LEGACY_ALIAS_FAILED") }
        try requireToken(store, account: account, expected: token)
        try store.disconnect(account: account)
        var unexpectedReads = 0
        guard case .reconnect = try store.loadOrMigrate(account: account, legacyRead: { _ in unexpectedReads += 1; return .token(token) }), unexpectedReads == 0 else { throw HostError.code("FIXTURE_UNPAIR_RESURRECTED_TOKEN") }
        let identity = try InstallationIdentity.loadOrCreate(in: root)
        let blocked = "https://blocked.example/"
        var blockedReads = 0
        guard case .reconnect = try store.loadOrMigrate(account: blocked, legacyRead: { _ in blockedReads += 1; return .unavailable(errSecInteractionNotAllowed) }), blockedReads == 2 else { throw HostError.code("FIXTURE_LEGACY_BLOCKED_FAILED") }
        guard case .reconnect = try store.loadOrMigrate(account: blocked, legacyRead: { _ in unexpectedReads += 1; return .token(token) }), unexpectedReads == 0 else { throw HostError.code("FIXTURE_LEGACY_RETRIED") }
        let bootstrap = try CoordinatorBootstrap.make(origin: URL(string: blocked)!, name: "Fixture", platform: "MACOS_ARM64", deviceToken: nil, pairingCode: "ABCDEF123456", directory: root, previousToken: { candidate in
            if case .token(let value) = try store.loadOrMigrate(account: candidate, legacyRead: { _ in unexpectedReads += 1; return .token(token) }) { return value }; return nil
        })
        guard bootstrap["installationId"] as? String == identity.uuidString.lowercased(), bootstrap["previousDeviceToken"] == nil, unexpectedReads == 0 else { throw HostError.code("FIXTURE_REPAIR_CHANGED_IDENTITY") }
        try store.store(newer, account: blocked)
        try requireToken(store, account: blocked, expected: newer)
        guard try InstallationIdentity.loadOrCreate(in: root) == identity else { throw HostError.code("FIXTURE_REPAIR_CHANGED_IDENTITY") }
        return ["ownerOnlyDirectory": true, "ownerOnlyFile": true, "atomicReplacement": true,
                "concurrentReadersSeeCompleteTokens": true, "directorySymlinkRejected": true, "ancestorSymlinkRejected": true,
                "tokenSymlinkRejected": true, "hardLinkRejected": true, "unsafePermissionsRejected": true,
                "foreignOwnerRejected": true, "extendedACLRejected": true, "malformedRecordRejected": true, "originIsolation": true,
                "failedWritePreservesPrevious": true, "silentLegacyMigration": true, "inaccessibleLegacyRequiresOnePairing": true,
                "legacyNotRetriedAfterDecision": true, "unpairPreventsLegacyResurrection": true, "installationIdentityPreserved": true]
    }
    private static func requireToken(_ store: DeviceCredentialStore, account: String, expected: String,
                                     legacyRead: ((String) -> SavedKeychainResult)? = nil) throws {
        var unexpected = false
        let read = legacyRead ?? { _ in unexpected = true; return .missing }
        guard case .token(let actual) = try store.loadOrMigrate(account: account, legacyRead: read), actual == expected, !unexpected else { throw HostError.code("FIXTURE_WRONG_SAVED_TOKEN") }
    }
    private static func throwUnexpectedLegacy() -> SavedKeychainResult { .token("unexpected-invalid-fixture-token") }
    private static func rejected(_ action: () throws -> Void) throws {
        do { try action() } catch { return }
        throw HostError.code("FIXTURE_UNSAFE_CREDENTIAL_ACCEPTED")
    }
}
