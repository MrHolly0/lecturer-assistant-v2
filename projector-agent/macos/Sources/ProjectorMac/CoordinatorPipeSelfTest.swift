import AppKit
import Darwin

@MainActor final class CoordinatorPipeSelfTest: NSObject, NSApplicationDelegate {
    let report: URL
    init(report: URL) { self.report = report }
    static func run(report: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = CoordinatorPipeSelfTest(report: report); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 40) { exit(3) }
        Task { @MainActor in
            var result: [String: Any], status: Int32 = 0
            do { result = try await AppDelegate.exerciseReadinessFixture { try await self.exercise() } }
            catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
            catch { result = ["success": false, "code": "COORDINATOR_PIPE_FIXTURE_FAILED"]; status = 1 }
            do {
                try FileManager.default.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
                let bytes = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
                try bytes.write(to: report, options: .atomic); FileHandle.standardOutput.write(bytes + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
    }
    private func exercise() async throws -> [String: Any] {
        let pipe = Pipe(), connection = AppDelegate.coordinatorReaderFixture(pipe.fileHandleForReading)
        defer { connection.cleanup(); try? pipe.fileHandleForReading.close() }
        // The real production source sees actual data followed by EOF, while its
        // queued UI work deliberately cannot run for a short bounded interval.
        try pipe.fileHandleForWriting.write(contentsOf: Data("{\"id\":\"fixture\",\"type\":\"GET_SCREENS\"}\n".utf8))
        try pipe.fileHandleForWriting.close()
        usleep(200_000)
        let beforeActor = connection.reader.snapshot
        guard beforeActor.detached, beforeActor.terminalDeliveries == 1, beforeActor.callbacks <= 3,
              beforeActor.dataDeliveries == 1 else { throw HostError.code("COORDINATOR_EOF_NOT_DETACHED_BEFORE_UI") }
        try await Task.sleep(for: .milliseconds(50))
        guard connection.state().closed, connection.state().count == 1 else { throw HostError.code("COORDINATOR_EOF_NOT_NEUTRALIZED") }
        await connection.duplicateEnd()
        guard connection.state().count == 1 else { throw HostError.code("COORDINATOR_EOF_DUPLICATE_CLEANUP") }
        let cancelled = Pipe()
        let cancelledReader = CoordinatorOutputReader(handle: cancelled.fileHandleForReading, data: { _ in }, ended: {})
        cancelledReader.stop(); cancelledReader.stop(); try cancelled.fileHandleForWriting.close()
        let reply = AppDelegate.makeScreenReplyFixture(), start = ProcessInfo.processInfo.systemUptime
        var replies = 0, maximumLatency = 0.0
        while ProcessInfo.processInfo.systemUptime - start < 18 {
            let sent = ProcessInfo.processInfo.systemUptime; try await reply()
            maximumLatency = max(maximumLatency, ProcessInfo.processInfo.systemUptime - sent); replies += 1
            try await Task.sleep(for: .milliseconds(200))
        }
        let held = ProcessInfo.processInfo.systemUptime - start, final = connection.reader.snapshot
        guard final.callbacks == beforeActor.callbacks, final.terminalDeliveries == 1,
              cancelledReader.snapshot.detached, cancelledReader.snapshot.terminalDeliveries == 0,
              replies > 50, maximumLatency < 1 else { throw HostError.code("COORDINATOR_PIPE_SPIN_OR_BLOCKED_UI") }
        try cancelled.fileHandleForReading.close()
        return ["success": true, "productionReader": true, "actualPipeEOF": true,
                "eofHandledOnce": true, "handlerDetachedBeforeMainActor": true, "queuedMainActorWorkBounded": true,
                "postEOFSchedulingStopped": true, "explicitCancelDetaches": true,
                "productionReadinessDialog": true, "heldBeyond15SecondNativeTimeout": held > 18,
                "nativeRepliesResponsive": true, "readinessDismissesSafely": true, "fixtureCleaned": true,
                "callbacksBeforeEnd": beforeActor.callbacks, "callbacksAfterQuietWait": final.callbacks,
                "terminalDeliveries": final.terminalDeliveries,
                "queuedMainActorTasks": final.dataDeliveries + final.terminalDeliveries,
                "readinessHeldSeconds": held, "getScreensReplies": replies, "maximumGetScreensLatency": maximumLatency,
                "userInstallationChanged": false, "networkUsed": false, "keychainUsed": false,
                "screenCaptured": false, "userWindowsUsed": false, "realPermissionAPIsCalled": false]
    }
}
