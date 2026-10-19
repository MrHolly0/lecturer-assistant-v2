import Foundation

@MainActor enum JournalSelfTest {
    static func run() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("projector-journal-check-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("display-recovery.json")
        let display = DisplayState(id: 1, mirror: 0, x: 0, y: 0, mode: 1, width: 1920, height: 1080, rotation: 0, hardware: "1:2:3")
        let valid = try JSONEncoder().encode(DisplayJournal(original: [display], applied: [display]))
        let pending = try JSONEncoder().encode(DisplayJournal(original: [display], applied: nil))
        for (bytes, expected) in [(pending, "RESTORE_OR_KEEP_EXISTING_CONFIGURATION_FIRST"), (valid, "RESTORE_OR_KEEP_EXISTING_CONFIGURATION_FIRST"), (Data("corrupt".utf8), "DISPLAY_RECOVERY_JOURNAL_INVALID")] {
            try bytes.write(to: file, options: .atomic)
            var snapshots = 0
            let controller = DisplayController(directory: root, snapshotProvider: { snapshots += 1; throw HostError.code("UNEXPECTED_DISPLAY_READ") })
            do { try controller.prepareIndependentOutput(); throw HostError.code("JOURNAL_GUARD_MISSING") }
            catch HostError.code(let code) { guard code == expected else { throw HostError.code("WRONG_JOURNAL_GUARD") } }
            guard snapshots == 0, try Data(contentsOf: file) == bytes else { throw HostError.code("JOURNAL_OVERWRITTEN_OR_DISPLAY_READ") }
        }
        print("PASS pending/valid/corrupt persisted journal prevents prepare before first display API; file bytes preserved; no display mutation")
    }
}
