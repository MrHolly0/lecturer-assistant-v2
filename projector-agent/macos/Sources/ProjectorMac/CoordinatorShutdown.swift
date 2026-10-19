import Foundation
import Darwin

enum CoordinatorShutdown {
    /// Only a child Process object created by this host is eligible. Never search
    /// by name, kill a process tree or reuse a PID without its start identity.
    static func stop(_ child: Process?, input: Pipe?) {
        try? input?.fileHandleForWriting.close()
        guard let child, child.isRunning else { return }
        let pid = child.processIdentifier
        let identity = try? NativeProcessStartIdentity.readTicks(pid: pid)
        child.terminate()
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while child.isRunning && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.01) }
        if child.isRunning, let identity, (try? NativeProcessStartIdentity.readTicks(pid: pid)) == identity {
            _ = kill(pid, SIGKILL)
        }
    }
}
