import Foundation
import CryptoKit
import Darwin

enum SavedDeviceCredential {
    case token(String)
    case reconnect
}

/// Only the revocable helper credential lives here. This is not a password vault:
/// another process running as this user (or root) can read it.
struct DeviceCredentialStore: Sendable {
    let directory: URL
    static let folder = "device-credentials"
    private struct Record: Codable {
        let schema: Int
        let state: String
        let token: String?
    }

    static func validToken(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    static func canonicalAccount(_ account: String) throws -> String {
        guard var parts = URLComponents(string: account), parts.scheme == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil, parts.path == "" || parts.path == "/" else {
            throw HostError.code("DEVICE_CREDENTIAL_ORIGIN_REJECTED")
        }
        parts.host = host.lowercased(); parts.path = "/"
        if parts.port == 443 { parts.port = nil }
        guard let value = parts.string else { throw HostError.code("DEVICE_CREDENTIAL_ORIGIN_REJECTED") }
        return value
    }

    static func filename(for account: String) throws -> String {
        SHA256.hash(data: Data(try canonicalAccount(account).utf8)).map { String(format: "%02x", $0) }.joined() + ".json"
    }

    /// A migration decision is persisted even when the old key cannot be read.
    /// Login and later starts therefore never retry Keychain or resurrect an unpaired key.
    func loadOrMigrate(account: String, legacyRead: (String) -> SavedKeychainResult = Keychain.readSilently) throws -> SavedDeviceCredential {
        try withLockedDirectory { root in
            let name = try Self.filename(for: account)
            if let record = try read(name, root: root) { return credential(record) }
            let alias = account.hasSuffix("/") ? String(account.dropLast()) : account + "/"
            for candidate in [account, alias] {
                if case .token(let token) = legacyRead(candidate), Self.validToken(token) {
                    try write(Record(schema: 1, state: "connected", token: token), name: name, root: root)
                    return .token(token)
                }
            }
            try write(Record(schema: 1, state: "reconnect", token: nil), name: name, root: root)
            return .reconnect
        }
    }

    func store(_ token: String, account: String, beforePublish: (() throws -> Void)? = nil) throws {
        guard Self.validToken(token) else { throw HostError.code("DEVICE_CREDENTIAL_TOKEN_REJECTED") }
        try withLockedDirectory { root in
            let name = try Self.filename(for: account)
            _ = try read(name, root: root) // Never replace a symlink, hard link or unsafe existing file.
            try write(Record(schema: 1, state: "connected", token: token), name: name, root: root, beforePublish: beforePublish)
        }
    }

    func disconnect(account: String) throws {
        try withLockedDirectory { root in
            let name = try Self.filename(for: account)
            _ = try read(name, root: root)
            try write(Record(schema: 1, state: "disconnected", token: nil), name: name, root: root)
        }
    }

    private func credential(_ record: Record) -> SavedDeviceCredential {
        if let token = record.token { return .token(token) }
        return .reconnect
    }

    static func validatePrivate(_ info: stat, directory: Bool) throws {
        guard info.st_uid == getuid(), info.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG),
              info.st_mode & 0o7777 == (directory ? 0o700 : 0o600), directory || info.st_nlink == 1 else {
            throw HostError.code("DEVICE_CREDENTIAL_ACCESS_REJECTED")
        }
    }

    private static func prepareNewFile(_ descriptor: Int32, directory: Bool) throws {
        // An inherited macOS ACL can grant access despite a 0700/0600 mode.
        // Remove it only on a newly created private object, never on user folders.
        guard let empty = acl_init(0) else { throw HostError.code("DEVICE_CREDENTIAL_ACL_REJECTED") }
        defer { acl_free(UnsafeMutableRawPointer(empty)) }
        guard acl_set_fd_np(descriptor, empty, ACL_TYPE_EXTENDED) == 0,
              fchmod(descriptor, directory ? 0o700 : 0o600) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_ACL_REJECTED") }
    }

    static func validateACL(_ descriptor: Int32) throws {
        guard let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED) else {
            if errno == ENOENT { return }
            throw HostError.code("DEVICE_CREDENTIAL_ACL_REJECTED")
        }
        defer { acl_free(UnsafeMutableRawPointer(acl)) }
        var entry: acl_entry_t?
        guard acl_get_entry(acl, Int32(ACL_FIRST_ENTRY.rawValue), &entry) != 0, errno == EINVAL else {
            throw HostError.code("DEVICE_CREDENTIAL_ACL_REJECTED")
        }
    }

    private func withLockedDirectory<T>(_ body: (Int32) throws -> T) throws -> T {
        // Walk each component by descriptor. O_NOFOLLOW on just the final file
        // would still follow a substituted ancestor directory.
        guard directory.isFileURL, directory.path.hasPrefix("/"),
              !directory.pathComponents.contains("..") else { throw HostError.code("DEVICE_CREDENTIAL_DIRECTORY_REJECTED") }
        var parent = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else { throw HostError.code("DEVICE_CREDENTIAL_ROOT_OPEN_REJECTED") }
        defer { close(parent) }
        for component in directory.pathComponents.dropFirst() {
            let next = openat(parent, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else { throw HostError.code("DEVICE_CREDENTIAL_ANCESTOR_REJECTED") }
            close(parent); parent = next
        }
        var info = stat()
        guard fstat(parent, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
              info.st_mode & 0o022 == 0 else { throw HostError.code("DEVICE_CREDENTIAL_PARENT_ACCESS_REJECTED") }
        let createdDirectory = mkdirat(parent, Self.folder, 0o700) == 0
        if !createdDirectory && errno != EEXIST { throw HostError.code("DEVICE_CREDENTIAL_DIRECTORY_CREATE_FAILED") }
        let root = openat(parent, Self.folder, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else { throw HostError.code("DEVICE_CREDENTIAL_DIRECTORY_REJECTED") }
        defer { close(root) }
        if createdDirectory { try Self.prepareNewFile(root, directory: true) }
        guard fstat(root, &info) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_DIRECTORY_REJECTED") }
        try Self.validatePrivate(info, directory: true)
        try Self.validateACL(root)
        var lock = openat(root, ".lock", O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0o600)
        let createdLock = lock >= 0
        if !createdLock && errno == EEXIST { lock = openat(root, ".lock", O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC) }
        guard lock >= 0 else { throw HostError.code("DEVICE_CREDENTIAL_LOCK_REJECTED") }
        defer { close(lock) }
        if createdLock { try Self.prepareNewFile(lock, directory: false) }
        guard fstat(lock, &info) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_LOCK_REJECTED") }
        try Self.validatePrivate(info, directory: false)
        try Self.validateACL(lock)
        guard flock(lock, LOCK_EX) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_LOCK_REJECTED") }
        defer { flock(lock, LOCK_UN) }
        return try body(root)
    }

    private func read(_ name: String, root: Int32) throws -> Record? {
        let file = openat(root, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if file < 0 {
            if errno == ENOENT { return nil }
            throw HostError.code("DEVICE_CREDENTIAL_READ_REJECTED")
        }
        defer { close(file) }
        var info = stat()
        guard fstat(file, &info) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_READ_REJECTED") }
        try Self.validatePrivate(info, directory: false)
        try Self.validateACL(file)
        guard info.st_size > 0, info.st_size <= 512 else { throw HostError.code("DEVICE_CREDENTIAL_RECORD_INVALID") }
        var bytes = [UInt8](repeating: 0, count: 513)
        let count = bytes.withUnsafeMutableBytes { Darwin.read(file, $0.baseAddress, $0.count) }
        guard count == info.st_size,
              let record = try? JSONDecoder().decode(Record.self, from: Data(bytes.prefix(count))),
              record.schema == 1, ["connected", "reconnect", "disconnected"].contains(record.state),
              record.state == "connected" ? record.token.map(Self.validToken) == true : record.token == nil else {
            throw HostError.code("DEVICE_CREDENTIAL_RECORD_INVALID")
        }
        return record
    }

    private func write(_ record: Record, name: String, root: Int32, beforePublish: (() throws -> Void)? = nil) throws {
        let data = try JSONEncoder().encode(record)
        let temporary = ".credential-" + UUID().uuidString + ".tmp"
        let file = openat(root, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard file >= 0 else { throw HostError.code("DEVICE_CREDENTIAL_WRITE_FAILED") }
        defer { close(file); unlinkat(root, temporary, 0) }
        try Self.prepareNewFile(file, directory: false)
        var info = stat()
        guard fstat(file, &info) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_WRITE_FAILED") }
        try Self.validatePrivate(info, directory: false)
        let count = data.withUnsafeBytes { Darwin.write(file, $0.baseAddress, $0.count) }
        guard count == data.count, fsync(file) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_WRITE_FAILED") }
        try beforePublish?()
        guard renameat(root, temporary, root, name) == 0, fsync(root) == 0 else { throw HostError.code("DEVICE_CREDENTIAL_WRITE_FAILED") }
    }
}
