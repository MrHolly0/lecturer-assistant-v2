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
    // Legacy migration only: no interactive access, writes or deletion.
    static func silentQuery(account: String) -> [String: Any] {
        let context = LAContext(); context.interactionNotAllowed = true
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                   kSecAttrAccount as String: account, kSecReturnData as String: true,
                                   kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
                                   kSecUseAuthenticationContext as String: context]
    }
    static func readSilently(account: String) -> SavedKeychainResult {
        readSilently(account: account) { query in
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            return decode(status: status, data: item as? Data)
        }
    }
    static func readSilently(account: String, copy: ([String: Any]) -> SavedKeychainResult) -> SavedKeychainResult {
        let query = silentQuery(account: account)
        // If configuring the authentication service failed, do not issue a query.
        guard let context = query[kSecUseAuthenticationContext as String] as? LAContext,
              context.interactionNotAllowed else { return .unavailable(errSecInteractionNotAllowed) }
        return copy(query)
    }
}
