import AppKit
import Foundation
import Darwin

@MainActor enum InstallerPayload {
    static func extract(from installer: URL, into stage: URL) throws -> URL {
        _ = try Installation.codeIdentity(installer)
        guard Bundle(url: installer)?.bundleIdentifier == Installation.installerIdentifier,
              Bundle(url: installer)?.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil else { throw BootstrapFailure.code("INVALID_INSTALLER_IDENTITY") }
        let archive = installer.appendingPathComponent("Contents/Resources/application.zip")
        let values = try archive.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size > 0, size <= 536_870_912 else { throw BootstrapFailure.code("INVALID_INSTALLER_PAYLOAD") }
        try Installation.checkParents(stage)
        try Installation.files.createDirectory(at: stage, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        _ = try Installation.run(URL(fileURLWithPath: "/usr/bin/ditto"), ["-x", "-k", archive.path, stage.path])
        let canonical = stage.appendingPathComponent(Installation.name)
        _ = try Installation.codeIdentity(canonical)
        guard Bundle(url: canonical)?.bundleIdentifier == Installation.identifier,
              Bundle(url: canonical)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == Bundle(url: installer)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String else { throw BootstrapFailure.code("INSTALLER_PAYLOAD_VERSION_MISMATCH") }
        _ = try Installation.readMetadata(canonical.appendingPathComponent("Contents/Resources/bootstrap.json"))
        return canonical
    }
    static func selfTest(installer: URL, report: URL, referenceCanonical: URL) {
        let root = report.standardizedFileURL.deletingLastPathComponent().appendingPathComponent(".native-fixtures.noindex/installer-" + UUID().uuidString)
        var result: [String: Any]; var status: Int32 = 0
        do {
            let extracted = try extract(from: installer, into: root)
            let actual = try Installation.codeIdentity(extracted), expected = try Installation.codeIdentity(referenceCanonical)
            guard actual == expected else { throw BootstrapFailure.code("INSTALLER_FIXTURE_PAYLOAD_IDENTITY") }
            result = ["success": true, "installerHasDistinctIdentifier": true, "installerHasNoURLClaims": true,
                      "sealedResourceExtracted": true, "strictSignatureVerified": true, "extractedCanonicalIdentityMatches": true,
                      "productionSchemeChanged": false, "installed": false, "keychainChanged": false, "displaySettingsChanged": false]
        } catch BootstrapFailure.code(let code) { result = ["success": false, "code": code]; status = 1 }
        catch { result = ["success": false, "code": "INSTALLER_FIXTURE_FAILED"]; status = 1 }
        do {
            if Installation.files.fileExists(atPath: root.path) { try Installation.files.removeItem(at: root) }
            result["fixtureCleaned"] = true
            try Installation.files.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
            let bytes = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            try bytes.write(to: report, options: [.atomic]); FileHandle.standardOutput.write(bytes + Data([10]))
        } catch { exit(2) }
        exit(status)
    }
}
