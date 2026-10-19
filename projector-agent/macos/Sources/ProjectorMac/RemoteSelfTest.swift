import AppKit
import Foundation
import Darwin

@MainActor final class RemoteSelfTest: NSObject, NSApplicationDelegate {
    private let reportURL: URL
    private var watchdog: Timer?
    init(reportURL: URL) { self.reportURL = reportURL }
    static func run(reportURL: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = RemoteSelfTest(reportURL: reportURL); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        watchdog = Timer.scheduledTimer(withTimeInterval: 40, repeats: false) { [weak self] _ in Task { @MainActor in self?.finish(["success": false, "code": "REMOTE_FIXTURE_TIMEOUT"], code: 1) } }
        Task { @MainActor in
            do { finish(try await RemoteWindow.exerciseLocalFixture(), code: 0) }
            catch HostError.code(let code) { finish(["success": false, "code": code], code: 1) }
            catch { finish(["success": false, "code": "REMOTE_FIXTURE_FAILED"], code: 1) }
        }
    }
    private func finish(_ report: [String: Any], code: Int32) {
        watchdog?.invalidate()
        do {
            let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: reportURL, options: [.atomic])
            FileHandle.standardOutput.write(data + Data([10]))
        } catch { FileHandle.standardError.write(Data("REMOTE_FIXTURE_REPORT_FAILED\n".utf8)); exit(2) }
        exit(code)
    }
}
