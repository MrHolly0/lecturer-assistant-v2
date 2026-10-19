import Foundation
import Darwin

enum ProcessIdentitySelfTest {
    static func run(checksURL: URL, reportURL: URL) throws {
        let temporary = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent(".projector-process-identity-" + UUID().uuidString + ".noindex", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var report: [String: Any]; var status: Int32 = 0
        do {
            let deterministic = try arithmeticFixture()
            let pid = ProcessInfo.processInfo.processIdentifier
            let native = try NativeProcessStartIdentity.readTicks(pid: pid)
            let dotnet = try probeDotnet(checksURL: checksURL, pid: pid, temporary: temporary)
            guard native == dotnet else { throw HostError.code("PROCESS_IDENTITY_RUNTIME_MISMATCH") }
            report = ["success": true, "deterministicArithmetic": deterministic, "crossRuntimeExactMatch": true,
                      "nativeTicks": native, "dotnetTicks": dotnet, "ownProcessOnly": true,
                      "productionUpdaterStarted": false, "userProcessesChanged": false,
                      "keychainUsed": false, "userInstallationChanged": false, "displaySettingsChanged": false]
        } catch HostError.code(let code) { report = ["success": false, "code": code]; status = 1 }
        catch { report = ["success": false, "code": "PROCESS_IDENTITY_FIXTURE_FAILED"]; status = 1 }
        try FileManager.default.removeItem(at: temporary)
        report["fixtureCleaned"] = !FileManager.default.fileExists(atPath: temporary.path)
        try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
        if status != 0 { exit(status) }
    }

    private static func arithmeticFixture() throws -> Bool {
        let cases: [(UInt64, UInt64, UInt64)] = [
            (0, 0, 621_355_968_000_000_000), (0, 1, 621_355_968_000_000_010),
            (1, 999_999, 621_355_968_019_999_990),
            (1_792_420_223, 99_980, 639_280_170_230_999_800),
            (1_792_420_223, 999_999, 639_280_170_239_999_990)
        ]
        for (seconds, microseconds, expected) in cases {
            guard try NativeProcessStartIdentity.utcTicks(seconds: seconds, microseconds: microseconds) == expected else {
                throw HostError.code("PROCESS_IDENTITY_ARITHMETIC_MISMATCH")
            }
        }
        for (seconds, microseconds) in [(UInt64(0), UInt64(1_000_000)), (UInt64.max, UInt64(0))] {
            do {
                _ = try NativeProcessStartIdentity.utcTicks(seconds: seconds, microseconds: microseconds)
                throw HostError.code("PROCESS_IDENTITY_INVALID_TIME_ACCEPTED")
            } catch HostError.code(let code) where code == "PROCESS_IDENTITY_TIME_INVALID" { }
        }
        return true
    }

    private static func probeDotnet(checksURL: URL, pid: Int32, temporary: URL) throws -> UInt64 {
        guard FileManager.default.fileExists(atPath: checksURL.path) else { throw HostError.code("PROCESS_IDENTITY_CHECKS_MISSING") }
        let environment = ProcessInfo.processInfo.environment
        let explicit = environment["PROJECTOR_DOTNET_HOST"] ?? environment["DOTNET_HOST_PATH"]
        let candidates = explicit.map { [$0] } ?? (environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/dotnet" }
        guard let host = candidates.first(where: { $0.hasPrefix("/") && FileManager.default.isExecutableFile(atPath: $0) }) else {
            throw HostError.code("PROCESS_IDENTITY_DOTNET_HOST_MISSING")
        }
        let process = Process(), output = Pipe(), finished = DispatchSemaphore(value: 0)
        process.executableURL = URL(fileURLWithPath: host)
        process.arguments = [checksURL.path, "--process-start-identity", String(pid)]
        var childEnvironment = environment
        childEnvironment["DOTNET_CLI_HOME"] = temporary.path; childEnvironment["DOTNET_NOLOGO"] = "1"
        process.environment = childEnvironment; process.standardInput = FileHandle.nullDevice
        process.standardOutput = output; process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in finished.signal() }
        try process.run()
        guard finished.wait(timeout: .now() + 30) == .success else {
            process.terminate()
            if finished.wait(timeout: .now() + 2) != .success { kill(process.processIdentifier, SIGKILL); process.waitUntilExit() }
            throw HostError.code("PROCESS_IDENTITY_DOTNET_PROBE_TIMEOUT")
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0, data.count <= 4096,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              (value["pid"] as? NSNumber)?.int32Value == pid, let ticks = value["ticks"] as? NSNumber else {
            throw HostError.code("PROCESS_IDENTITY_DOTNET_PROBE_FAILED")
        }
        return ticks.uint64Value
    }
}
