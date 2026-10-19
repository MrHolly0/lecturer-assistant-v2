import AppKit
import CoreGraphics
import Foundation

struct DisplayState: Codable, Equatable {
    let id: UInt32
    let mirror: UInt32
    let x: Int32
    let y: Int32
    let mode: Int32
    let width: Int
    let height: Int
    let rotation: Double
    let hardware: String
}
struct DisplayJournal: Codable {
    let original: [DisplayState]
    let applied: [DisplayState]?
}

@MainActor final class DisplayController {
    private(set) var journal: DisplayJournal?
    private let journalURL: URL
    private let snapshotProvider: @MainActor () throws -> [DisplayState]
    private var journalReadFailed = false
    init(directory: URL, snapshotProvider: @escaping @MainActor () throws -> [DisplayState] = { try DisplayController.snapshot() }) {
        journalURL = directory.appendingPathComponent("display-recovery.json")
        self.snapshotProvider = snapshotProvider
        do { journal = try readPersistedJournal() } catch { journalReadFailed = true }
    }
    private func readPersistedJournal() throws -> DisplayJournal? {
        guard FileManager.default.fileExists(atPath: journalURL.path) else { return nil }
        do {
            let properties = try journalURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard properties.isRegularFile == true, properties.isSymbolicLink != true, let size = properties.fileSize, size > 0, size <= 262144 else { throw HostError.code("DISPLAY_RECOVERY_JOURNAL_INVALID") }
            let saved = try JSONDecoder().decode(DisplayJournal.self, from: Data(contentsOf: journalURL))
            let originalIDs = saved.original.map(\.id), appliedIDs = saved.applied?.map(\.id)
            guard !originalIDs.isEmpty, originalIDs.count <= 64, Set(originalIDs).count == originalIDs.count,
                  appliedIDs == nil || (Set(appliedIDs!) == Set(originalIDs) && appliedIDs!.count == originalIDs.count),
                  (saved.original + (saved.applied ?? [])).allSatisfy({ $0.id != 0 && $0.width > 0 && $0.height > 0 && $0.rotation.isFinite && $0.hardware.count <= 512 }) else { throw HostError.code("DISPLAY_RECOVERY_JOURNAL_INVALID") }
            return saved
        } catch { throw HostError.code("DISPLAY_RECOVERY_JOURNAL_INVALID") }
    }
    private func requireNoPersistedRecovery() throws {
        if journalReadFailed { throw HostError.code("DISPLAY_RECOVERY_JOURNAL_INVALID") }
        // Re-read existence as well: a process crash/restart must not make the original Clone snapshot disappear.
        if FileManager.default.fileExists(atPath: journalURL.path) {
            do { journal = try readPersistedJournal() } catch { journalReadFailed = true; throw error }
            throw HostError.code("RESTORE_OR_KEEP_EXISTING_CONFIGURATION_FIRST")
        }
        guard journal == nil else { throw HostError.code("RESTORE_OR_KEEP_EXISTING_CONFIGURATION_FIRST") }
    }
    static func snapshot() throws -> [DisplayState] {
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(0, nil, &count) == .success else { throw HostError.code("DISPLAY_ENUMERATION_FAILED") }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { throw HostError.code("DISPLAY_ENUMERATION_FAILED") }
        return try ids.prefix(Int(count)).map { id in
            guard let mode = CGDisplayCopyDisplayMode(id) else { throw HostError.code("DISPLAY_MODE_UNAVAILABLE") }
            let bounds = CGDisplayBounds(id)
            return DisplayState(id: id, mirror: CGDisplayMirrorsDisplay(id), x: Int32(bounds.origin.x), y: Int32(bounds.origin.y), mode: mode.ioDisplayModeID, width: CGDisplayPixelsWide(id), height: CGDisplayPixelsHigh(id), rotation: CGDisplayRotation(id), hardware: "\(CGDisplayVendorNumber(id)):\(CGDisplayModelNumber(id)):\(CGDisplaySerialNumber(id))")
        }.sorted { $0.id < $1.id }
    }
    static func screenID(_ id: UInt32) -> String {
        let bounds = CGDisplayBounds(id)
        let mode = CGDisplayCopyDisplayMode(id)?.ioDisplayModeID ?? -1
        return "\(id):\(Int(bounds.origin.x)):\(Int(bounds.origin.y)):\(mode):\(CGDisplayRotation(id)):\(CGDisplayVendorNumber(id)):\(CGDisplayModelNumber(id)):\(CGDisplaySerialNumber(id))"
    }
    static func screens() -> [[String: Any]] {
        NSScreen.screens.prefix(16).compactMap { screen in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
            let id = number.uint32Value
            return ["id": screenID(id), "label": String(screen.localizedName.prefix(120)), "width": CGDisplayPixelsWide(id),
                    "height": CGDisplayPixelsHigh(id), "isPrimary": id == CGMainDisplayID()]
        }
    }
    func prepareIndependentOutput() throws {
        try requireNoPersistedRecovery()
        let original = try snapshotProvider()
        guard original.count >= 2 else { throw HostError.code("NO_EXTERNAL_DISPLAY") }
        var config: CGDisplayConfigRef?
        guard CGBeginDisplayConfiguration(&config) == .success, let config else { throw HostError.code("DISPLAY_CONFIGURATION_UNAVAILABLE") }
        var right = original.filter { $0.mirror == 0 }.map { CGDisplayBounds($0.id).maxX }.max() ?? 0
        for display in original where display.mirror != 0 {
            guard CGConfigureDisplayMirrorOfDisplay(config, display.id, kCGNullDirectDisplay) == .success,
                  CGConfigureDisplayOrigin(config, display.id, Int32(right), 0) == .success else {
                CGCancelDisplayConfiguration(config); throw HostError.code("DISPLAY_PREPARATION_FAILED")
            }
            right += CGDisplayBounds(display.id).width
        }
        // Save before APPLY: a crash or failed applied-snapshot cannot erase the original Clone configuration.
        journal = DisplayJournal(original: original, applied: nil)
        do { try persistJournal() } catch { CGCancelDisplayConfiguration(config); throw error }
        // Session only, never persist an installation-wide mode. The guarded journal owns restoration.
        guard CGCompleteDisplayConfiguration(config, .forSession) == .success else { throw HostError.code("DISPLAY_PREPARATION_FAILED") }
        let applied = try Self.snapshot()
        journal = DisplayJournal(original: original, applied: applied)
        try persistJournal()
    }
    func restore(locallyConfirmed: Bool) throws -> String {
        if journalReadFailed { throw HostError.code("DISPLAY_RECOVERY_JOURNAL_INVALID") }
        if journal == nil { journal = try readPersistedJournal() }
        guard let journal else { return "UNCHANGED" }
        let current = try Self.snapshot()
        guard current.map(\.id) == journal.original.map(\.id) else { return "HARDWARE_CHANGED_NO_RESTORE" }
        if current == journal.original { try discardJournal(); return "UNCHANGED" }
        guard let applied = journal.applied else { return "PREPARATION_INTERRUPTED_USE_MANUAL_RECOVERY" }
        guard current == applied else { return "USER_CHANGED_CONFIGURATION_NO_RESTORE" }
        guard locallyConfirmed else { return "LOCAL_CONFIRMATION_REQUIRED" }
        var config: CGDisplayConfigRef?
        guard CGBeginDisplayConfiguration(&config) == .success, let config else { throw HostError.code("DISPLAY_CONFIGURATION_UNAVAILABLE") }
        for display in journal.original {
            let modes = CGDisplayCopyAllDisplayModes(display.id, nil) as? [CGDisplayMode] ?? []
            guard let mode = modes.first(where: { $0.ioDisplayModeID == display.mode }),
                  CGConfigureDisplayMirrorOfDisplay(config, display.id, display.mirror) == .success,
                  CGConfigureDisplayOrigin(config, display.id, display.x, display.y) == .success,
                  CGConfigureDisplayWithDisplayMode(config, display.id, mode, nil) == .success else {
                CGCancelDisplayConfiguration(config); throw HostError.code("ORIGINAL_MODE_NO_LONGER_AVAILABLE")
            }
        }
        guard CGCompleteDisplayConfiguration(config, .forSession) == .success else { throw HostError.code("DISPLAY_RESTORE_FAILED") }
        try discardJournal(); return "RESTORED"
    }
    func discardJournal() throws {
        journal = nil
        if FileManager.default.fileExists(atPath: journalURL.path) { try FileManager.default.removeItem(at: journalURL) }
    }
    private func persistJournal() throws {
        guard let journal else { return }
        try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journalURL.path)
    }
}

enum HostError: Error { case code(String) }
