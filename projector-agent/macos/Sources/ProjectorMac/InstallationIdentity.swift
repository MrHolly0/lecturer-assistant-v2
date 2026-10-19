import Foundation
import Darwin

enum InstallationIdentity {
    static let filename = "installation-id.txt"

    static func loadOrCreate(in directory: URL) throws -> UUID {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var root = stat()
        guard lstat(directory.path, &root) == 0, root.st_mode & S_IFMT == S_IFDIR, root.st_uid == getuid() else {
            throw HostError.code("INSTALLATION_ID_DIRECTORY_REJECTED")
        }
        let destination = directory.appendingPathComponent(filename)
        if let existing = try read(destination) { return existing }

        // Publish a complete file with an exclusive hard link. Concurrent starts can
        // select the winner but can never overwrite its ID or observe a partial write.
        let id = UUID()
        let temporary = directory.appendingPathComponent(".installation-id-" + UUID().uuidString + ".tmp")
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw HostError.code("INSTALLATION_ID_CREATE_FAILED") }
        defer { close(descriptor); unlink(temporary.path) }
        let bytes = Array(id.uuidString.lowercased().utf8)
        let count = bytes.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, $0.count) }
        guard count == bytes.count, fsync(descriptor) == 0 else { throw HostError.code("INSTALLATION_ID_WRITE_FAILED") }
        if link(temporary.path, destination.path) == 0 { return id }
        guard errno == EEXIST, let winner = try read(destination) else { throw HostError.code("INSTALLATION_ID_CREATE_FAILED") }
        return winner
    }

    private static func read(_ file: URL) throws -> UUID? {
        let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        if descriptor < 0 {
            if errno == ENOENT { return nil }
            throw HostError.code("INSTALLATION_ID_READ_FAILED")
        }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_size == 36 else {
            throw HostError.code("INSTALLATION_ID_INVALID")
        }
        var bytes = [UInt8](repeating: 0, count: 38)
        let count = bytes.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
        guard count == info.st_size, let value = String(bytes: bytes.prefix(count), encoding: .utf8) else {
            throw HostError.code("INSTALLATION_ID_INVALID")
        }
        let text = value
        guard let id = UUID(uuidString: text), text.lowercased() == id.uuidString.lowercased(),
              id.uuidString != "00000000-0000-0000-0000-000000000000" else {
            throw HostError.code("INSTALLATION_ID_INVALID")
        }
        return id
    }
}

enum CoordinatorBootstrap {
    static func make(origin: URL, name: String, platform: String, deviceToken: String?, pairingCode: String?,
                     directory: URL, previousToken: (String) throws -> String?) throws -> [String: Any] {
        var value: [String: Any] = ["origin": origin.absoluteString, "name": name, "platform": platform]
        if let pairingCode {
            value["pairingCode"] = pairingCode
            value["installationId"] = try InstallationIdentity.loadOrCreate(in: directory).uuidString.lowercased()
            // The only alias is an optional trailing slash at the same HTTPS root.
            // Never use origin.txt or search accounts belonging to another site.
            guard let parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
                  parts.scheme == "https", parts.host != nil, parts.user == nil, parts.password == nil,
                  parts.query == nil, parts.fragment == nil, parts.path == "" || parts.path == "/" else {
                throw HostError.code("PAIRING_ORIGIN_REJECTED")
            }
            let account = origin.absoluteString
            let alias = account.hasSuffix("/") ? String(account.dropLast()) : account + "/"
            if let token = try previousToken(account) ?? previousToken(alias) { value["previousDeviceToken"] = token }
        } else if let deviceToken { value["deviceToken"] = deviceToken }
        return value
    }
}
