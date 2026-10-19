import AppKit
import Darwin

/// No NSApplication, windows, permission APIs or OS picker are created here.
@MainActor enum CaptureSelectionSelfTest {
    static func run(report: URL) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 20) { exit(3) }
        Task { @MainActor in
            var result: [String: Any], status: Int32 = 0
            do {
                guard NSApp == nil else { throw HostError.code("CAPTURE_SELECTION_FIXTURE_NOT_HEADLESS") }
                result = try await SystemSourcePicker.exerciseDeadlineFixture()
                for (key, value) in try await NativeCapture.exerciseManualSelectionFixture() { result[key] = value }
                for (key, value) in try await NativeCapture.exerciseSnapshotFixture() { result[key] = value }
                guard NSApp == nil else { throw HostError.code("CAPTURE_SELECTION_FIXTURE_CREATED_APPLICATION") }
                result["success"] = true; result["applicationCreated"] = false
                for key in ["screenCaptured", "realPermissionAPIsCalled", "userInstallationChanged", "userWindowsUsed", "networkUsed", "keychainUsed"] { result[key] = false }
            } catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
            catch { result = ["success": false, "code": "CAPTURE_SELECTION_FIXTURE_FAILED"]; status = 1 }
            do {
                try FileManager.default.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
                let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
                try bytes.write(to: report, options: .atomic); FileHandle.standardOutput.write(bytes + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
        dispatchMain()
    }
}
