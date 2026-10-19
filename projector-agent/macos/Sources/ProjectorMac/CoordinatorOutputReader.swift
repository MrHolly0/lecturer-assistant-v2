import Foundation

/// EOF must detach the source before scheduling UI work. A readable closed pipe
/// otherwise calls its handler continuously while the main actor is occupied.
final class CoordinatorOutputReader: @unchecked Sendable {
    struct Snapshot: Sendable {
        let callbacks: Int
        let dataDeliveries: Int
        let terminalDeliveries: Int
        let detached: Bool
    }
    private let handle: FileHandle
    private let lock = NSLock()
    private var active = true
    private var callbacks = 0, dataDeliveries = 0, terminalDeliveries = 0
    private let data: @Sendable (Data) -> Void
    private let ended: @Sendable () -> Void
    init(handle: FileHandle, data: @escaping @Sendable (Data) -> Void, ended: @escaping @Sendable () -> Void) {
        self.handle = handle; self.data = data; self.ended = ended
        handle.readabilityHandler = { [weak self] source in self?.read(source) }
    }
    private func read(_ source: FileHandle) {
        let bytes = source.availableData
        let deliver: Bool = lock.withLock {
            callbacks += 1
            guard active else { return false }
            if bytes.isEmpty { active = false; terminalDeliveries += 1 }
            else { dataDeliveries += 1 }
            return true
        }
        guard deliver else { return }
        if bytes.isEmpty {
            source.readabilityHandler = nil
            ended()
        } else { data(bytes) }
    }
    func stop() {
        lock.withLock { active = false }
        handle.readabilityHandler = nil
    }
    var snapshot: Snapshot {
        lock.withLock { Snapshot(callbacks: callbacks, dataDeliveries: dataDeliveries, terminalDeliveries: terminalDeliveries, detached: !active && handle.readabilityHandler == nil) }
    }
}
