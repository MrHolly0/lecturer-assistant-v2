import Foundation
import Security

/// A compatible canonical bootstrap is a stable macOS consent identity. Updating
/// a host must not rewrite its executable, resources, signature or Login Item.
@MainActor enum StableBootstrapUpgrade {
    static func preservedTarget(_ target: URL, incoming: URL, expectedIdentifier: String = Installation.identifier) throws -> Bool {
        try Installation.checkParents(target); try Installation.checkParents(incoming)
        _ = try Installation.codeIdentity(incoming)
        _ = try Installation.codeIdentity(target)
        guard let old = Bundle(url: target), let new = Bundle(url: incoming),
              old.bundleIdentifier == expectedIdentifier, new.bundleIdentifier == expectedIdentifier else { throw BootstrapFailure.code("BOOTSTRAP_IDENTITY_REJECTED") }
        let previous = try Installation.readMetadata(target.appendingPathComponent("Contents/Resources/bootstrap.json"))
        let candidate = try Installation.readMetadata(incoming.appendingPathComponent("Contents/Resources/bootstrap.json"))
        guard previous["platform"] as? String == candidate["platform"] as? String,
              previous["protocolVersion"] as? Int == 1, candidate["protocolVersion"] as? Int == 1,
              let oldVersion = previous["version"] as? String, oldVersion.compare("0.2.2", options: .numeric) != .orderedAscending,
              old.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == oldVersion,
              old.object(forInfoDictionaryKey: "CFBundleExecutable") as? String == "ProjectorBootstrap",
              new.object(forInfoDictionaryKey: "CFBundleExecutable") as? String == "ProjectorBootstrap",
              let schemes = old.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]],
              schemes.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains("lecturer-projector") == true }) else {
            throw BootstrapFailure.code("BOOTSTRAP_COMPATIBILITY_REQUIRES_EXPLICIT_UPGRADE")
        }
        let generation = old.object(forInfoDictionaryKey: "LABootstrapCompatibilityGeneration") as? Int
        let legacy = generation == nil && oldVersion.compare("0.2.7", options: .numeric) != .orderedDescending
        guard generation == 1 || legacy,
              new.object(forInfoDictionaryKey: "LABootstrapCompatibilityGeneration") as? Int == 1 else { throw BootstrapFailure.code("BOOTSTRAP_COMPATIBILITY_REQUIRES_EXPLICIT_UPGRADE") }
        let oldMode = old.object(forInfoDictionaryKey: "LAReleaseMode") as? String
        let newMode = new.object(forInfoDictionaryKey: "LAReleaseMode") as? String
        guard oldMode == newMode, newMode == "development" || newMode == "production" else { throw BootstrapFailure.code("BOOTSTRAP_SIGNER_REJECTED") }
        let oldTeam = try team(target), newTeam = try team(incoming)
        if let newTeam {
            guard oldTeam == newTeam else { throw BootstrapFailure.code("BOOTSTRAP_SIGNER_REJECTED") }
            var requirement: SecRequirement?
            let publisher = "anchor apple generic and certificate leaf[subject.OU] = \"" + newTeam + "\""
            let text = newMode == "production" ? publisher + " and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists" : publisher
            guard SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess else { throw BootstrapFailure.code("BOOTSTRAP_SIGNER_REJECTED") }
            for bundle in [target, incoming] {
                var code: SecStaticCode?
                guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &code) == errSecSuccess, let code,
                      SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckNestedCode | kSecCSCheckAllArchitectures), requirement) == errSecSuccess else { throw BootstrapFailure.code("BOOTSTRAP_SIGNER_REJECTED") }
            }
        } else {
            guard oldTeam == nil, oldMode == "development", newMode == "development" else { throw BootstrapFailure.code("BOOTSTRAP_SIGNER_REJECTED") }
        }
        return true
    }
    static func installHost(incoming: URL, preserving target: URL, installRoot: URL, expectedIdentifier: String = Installation.identifier) throws {
        guard try preservedTarget(target, incoming: incoming, expectedIdentifier: expectedIdentifier) else { throw BootstrapFailure.code("BOOTSTRAP_COMPATIBILITY_REQUIRES_EXPLICIT_UPGRADE") }
        let identity = try Installation.codeIdentity(target)
        let resources = incoming.appendingPathComponent("Contents/Resources")
        let launcher = incoming.appendingPathComponent("Contents/MacOS/launcher/Projector.Launcher")
        _ = try Installation.run(launcher, ["bootstrap-check", installRoot.path, resources.appendingPathComponent("bootstrap.json").path])
        _ = try Installation.run(launcher, ["bootstrap", installRoot.path, resources.appendingPathComponent("seed.zip").path, resources.appendingPathComponent("bootstrap.json").path])
        guard try Installation.codeIdentity(target) == identity else { throw BootstrapFailure.code("STABLE_BOOTSTRAP_CHANGED") }
    }
    static func currentHostVersion(root: URL) -> String? {
        let path = root.appendingPathComponent("current.json")
        guard let values = try? path.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
              values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? 8193) <= 8192,
              let bytes = try? Data(contentsOf: path), let pointer = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let version = pointer["version"] as? String, version.split(separator: ".").count == 3,
              version.utf8.allSatisfy({ (48...57).contains($0) || $0 == 46 }) else { return nil }
        return version
    }
    private static func team(_ bundle: URL) throws -> String? {
        var code: SecStaticCode?, info: CFDictionary?
        guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &code) == errSecSuccess, let code,
              SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess else { throw BootstrapFailure.code("SIGNATURE_UNAVAILABLE") }
        guard let value = (info as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String, !value.isEmpty else { return nil }
        guard value.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) }) else { throw BootstrapFailure.code("BOOTSTRAP_SIGNER_REJECTED") }
        return value
    }
}
