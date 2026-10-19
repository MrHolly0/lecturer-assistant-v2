import Foundation
import CryptoKit
import Darwin

@MainActor enum StableBootstrapSelfTest {
    static func run(reference: URL, previous: URL?, report: URL) throws {
        guard let path = realpath(FileManager.default.temporaryDirectory.path, nil) else { throw BootstrapFailure.code("FIXTURE_TEMP_UNAVAILABLE") }
        defer { free(path) }
        let root = URL(fileURLWithPath: String(cString: path)).appendingPathComponent(".bootstrap-upgrade-" + UUID().uuidString + ".noindex")
        var result: [String: Any], status: Int32 = 0
        var stage = "CREATE_FIXTURE"
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try Installation.checkParents(root)
            let link = root.appendingPathComponent("symlink")
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root)
            try rejected { try Installation.checkParents(link) }
            try rejected { try Installation.checkParents(link.appendingPathComponent("missing/deeper")) }
            try rejected { try Installation.checkParents(URL(fileURLWithPath: root.path + "/missing/../outside")) }
            try rejected { try Installation.checkParents(URL(fileURLWithPath: root.path + "/missing/./outside")) }
            try rejected { try Installation.checkParents(URL(fileURLWithPath: "/tmp")) }
            let incoming = root.appendingPathComponent("Incoming Fixture.app"), canonical = root.appendingPathComponent("Canonical Fixture.app")
            let id = "org.example.projector-fixture." + UUID().uuidString.lowercased()
            try FileManager.default.copyItem(at: reference, to: incoming)
            try configure(incoming, id: id, oldVersion: nil)
            try FileManager.default.copyItem(at: previous ?? reference, to: canonical)
            try configure(canonical, id: id, oldVersion: previous == nil ? "0.2.7" : nil)
            guard try Installation.installationTarget(candidates: [canonical]) == canonical else { throw BootstrapFailure.code("BOOTSTRAP_FIXTURE_CANONICAL_NOT_REUSED") }
            try rejected { _ = try Installation.installationTarget(candidates: [canonical, incoming]) }
            stage = "VERIFY_COPIED_BUNDLES"
            let originalHash = try Installation.codeIdentity(canonical), originalFiles = try fileDigests(canonical)
            let data = root.appendingPathComponent("Isolated Data"), install = data.appendingPathComponent("install")
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let oldResources = canonical.appendingPathComponent("Contents/Resources")
            stage = "INITIAL_SEED_INSTALL"
            _ = try Installation.run(incoming.appendingPathComponent("Contents/MacOS/launcher/Projector.Launcher"), ["bootstrap", install.path, oldResources.appendingPathComponent("seed.zip").path, oldResources.appendingPathComponent("bootstrap.json").path])
            let oldVersion = StableBootstrapUpgrade.currentHostVersion(root: install)
            let candidate = try Installation.readMetadata(incoming.appendingPathComponent("Contents/Resources/bootstrap.json"))
            let expected = candidate["version"] as! String
            guard let oldVersion, oldVersion.compare(expected, options: .numeric) == .orderedAscending else { throw BootstrapFailure.code("BOOTSTRAP_FIXTURE_NOT_TWO_VERSIONS") }
            stage = "PRESERVED_BOOTSTRAP_UPGRADE"
            try StableBootstrapUpgrade.installHost(incoming: incoming, preserving: canonical, installRoot: install, expectedIdentifier: id)
            guard StableBootstrapUpgrade.currentHostVersion(root: install) == expected,
                  try Installation.codeIdentity(canonical) == originalHash,
                  try fileDigests(canonical) == originalFiles else { throw BootstrapFailure.code("BOOTSTRAP_FIXTURE_IDENTITY_CHANGED") }
            // Opening the retained app sees a newer installed host and cannot reseed its older runtime.
            guard !Installation.shouldActivateSeed(installedVersion: expected, seedVersion: oldVersion) else { throw BootstrapFailure.code("BOOTSTRAP_FIXTURE_RESEED_ROLLBACK") }
            stage = "PRESERVED_BOOTSTRAP_UPGRADE"
            try StableBootstrapUpgrade.installHost(incoming: incoming, preserving: canonical, installRoot: install, expectedIdentifier: id)
            guard try Installation.codeIdentity(canonical) == originalHash else { throw BootstrapFailure.code("BOOTSTRAP_FIXTURE_REPEATED_UPGRADE_CHANGED") }
            let incompatible = root.appendingPathComponent("Incompatible Fixture.app")
            try FileManager.default.copyItem(at: incoming, to: incompatible)
            try updatePlist(incompatible) { $0["LABootstrapCompatibilityGeneration"] = 999 }
            try sign(incompatible)
            try rejected { _ = try StableBootstrapUpgrade.preservedTarget(incompatible, incoming: incoming, expectedIdentifier: id) }
            let wrongMode = root.appendingPathComponent("Other Mode Fixture.app")
            try FileManager.default.copyItem(at: canonical, to: wrongMode)
            try updatePlist(wrongMode) { $0["LAReleaseMode"] = "production" }
            try sign(wrongMode)
            try rejected { _ = try StableBootstrapUpgrade.preservedTarget(wrongMode, incoming: incoming, expectedIdentifier: id) }
            let tampered = root.appendingPathComponent("Tampered Fixture.app")
            try FileManager.default.copyItem(at: canonical, to: tampered)
            try Data("tampered".utf8).write(to: tampered.appendingPathComponent("Contents/Resources/bootstrap.json"))
            try rejected { _ = try StableBootstrapUpgrade.preservedTarget(tampered, incoming: incoming, expectedIdentifier: id) }
            result = ["success": true, "twoVersionManifestsUpgraded": true, "canonicalCDHashUnchanged": true,
                      "canonicalFilesUnchanged": true, "newHostActivated": true, "oldSeedCannotRollback": true,
                      "repeatedInstallPreservesIdentity": true, "incompatibleGenerationRejected": true,
                      "releaseModeMismatchRejected": true, "tamperedSignatureRejected": true,
                      "realPrivateTempAccepted": true, "symlinkParentsRejected": true, "deeperSymlinkParentsRejected": true,
                      "dotTraversalRejected": true, "systemTempAliasRejected": true,
                      "existingCanonicalReused": true, "ambiguousCanonicalRejected": true,
                      "previousPackageProvided": previous != nil, "systemSchemeChanged": false, "loginItemsChanged": false,
                      "permissionRequested": false, "userInstallationChanged": false, "keychainUsed": false, "networkUsed": false]
        } catch BootstrapFailure.code(let error) { result = ["success": false, "code": error, "stage": stage]; status = 1 }
        catch { result = ["success": false, "code": "STABLE_BOOTSTRAP_FIXTURE_FAILED"]; status = 1 }
        do {
            if FileManager.default.fileExists(atPath: root.path) { try FileManager.default.removeItem(at: root) }
            guard !FileManager.default.fileExists(atPath: root.path) else { throw BootstrapFailure.code("FIXTURE_CLEANUP_FAILED") }
        } catch { result = ["success": false, "code": "FIXTURE_CLEANUP_FAILED"]; status = 1 }
        try FileManager.default.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
        let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
        try bytes.write(to: report, options: .atomic); FileHandle.standardOutput.write(bytes + Data([10]))
        if status != 0 { exit(status) }
    }
    private static func configure(_ bundle: URL, id: String, oldVersion: String?) throws {
        try updatePlist(bundle) { value in
            value["CFBundleIdentifier"] = id; value["CFBundleDisplayName"] = "Isolated bootstrap fixture"
            if let oldVersion {
                value["CFBundleShortVersionString"] = oldVersion; value["CFBundleVersion"] = oldVersion
                value.removeValue(forKey: "LABootstrapCompatibilityGeneration")
            }
        }
        if let oldVersion {
            let file = bundle.appendingPathComponent("Contents/Resources/bootstrap.json")
            var value = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
            value["version"] = oldVersion; try JSONSerialization.data(withJSONObject: value).write(to: file)
        }
        try sign(bundle)
    }
    private static func updatePlist(_ bundle: URL, change: (inout [String: Any]) -> Void) throws {
        let path = bundle.appendingPathComponent("Contents/Info.plist")
        var value = try PropertyListSerialization.propertyList(from: Data(contentsOf: path), format: nil) as! [String: Any]
        change(&value); try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0).write(to: path)
    }
    private static func sign(_ bundle: URL) throws {
        _ = try Installation.run(URL(fileURLWithPath: "/usr/bin/codesign"), ["--force", "--sign", "-", bundle.path])
    }
    private static func fileDigests(_ bundle: URL) throws -> [String: String] {
        var result: [String: String] = [:]
        guard let entries = FileManager.default.enumerator(at: bundle, includingPropertiesForKeys: [.isRegularFileKey]) else { throw BootstrapFailure.code("FIXTURE_ENUMERATION_FAILED") }
        for case let file as URL in entries where (try file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true {
            result[String(file.path.dropFirst(bundle.path.count))] = SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined()
        }
        return result
    }
    private static func rejected(_ action: () throws -> Void) throws {
        do { try action() } catch { return }
        throw BootstrapFailure.code("BOOTSTRAP_FIXTURE_UNSAFE_COMPATIBILITY_ACCEPTED")
    }
}
