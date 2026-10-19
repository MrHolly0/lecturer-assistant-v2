import Foundation
import Security
import LocalAuthentication

enum SavedKeychainResult {
    case token(String)
    case missing
    case unavailable(OSStatus)
}

enum Keychain {
    static let service = "ru.university.lecturer-projector"
    static func decode(status: OSStatus, data: Data?) -> SavedKeychainResult {
        if status == errSecItemNotFound { return .missing }
        guard status == errSecSuccess else { return .unavailable(status) }
        guard let data, let token = String(data: data, encoding: .utf8), !token.isEmpty else { return .unavailable(errSecDecode) }
        return .token(token)
    }
    static func readResult(account: String, allowInteraction: Bool) -> SavedKeychainResult {
        let context = LAContext(); context.interactionNotAllowed = !allowInteraction
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                   kSecAttrAccount as String: account, kSecReturnData as String: true,
                                   kSecUseAuthenticationContext as String: context]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return decode(status: status, data: item as? Data)
    }
    static func readForPairing(account: String) throws -> String? {
        switch readResult(account: account, allowInteraction: true) {
        case .token(let token): return token
        case .missing: return nil
        case .unavailable: throw HostError.code("KEYCHAIN_ACCESS_REQUIRED")
        }
    }
    static func store(_ token: String, account: String) throws {
        try store(token, account: account, update: { SecItemUpdate($0 as CFDictionary, $1 as CFDictionary) }, add: { SecItemAdd($0 as CFDictionary, nil) })
    }
    static func store(_ token: String, account: String,
                      update: ([String: Any], [String: Any]) -> OSStatus, add: ([String: Any]) -> OSStatus) throws {
        let match: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let data = Data(token.utf8)
        var status = update(match, [kSecValueData as String: data])
        if status == errSecItemNotFound {
            var query = match; query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = add(query)
        }
        guard status == errSecSuccess else { throw HostError.code("KEYCHAIN_WRITE_FAILED") }
    }
    static func remove(account: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
    }
}
