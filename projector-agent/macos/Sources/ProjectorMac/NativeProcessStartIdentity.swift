import Foundation
import Darwin

enum NativeProcessStartIdentity {
    private static let unixEpochTicks: UInt64 = 621_355_968_000_000_000

    static func readTicks(pid: Int32) throws -> UInt64 {
        var info = proc_bsdinfo()
        let size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
        guard size == MemoryLayout<proc_bsdinfo>.size else { throw HostError.code("PROCESS_IDENTITY_UNAVAILABLE") }
        return try utcTicks(seconds: UInt64(info.pbi_start_tvsec), microseconds: UInt64(info.pbi_start_tvusec))
    }

    static func utcTicks(seconds: UInt64, microseconds: UInt64) throws -> UInt64 {
        guard microseconds < 1_000_000 else { throw HostError.code("PROCESS_IDENTITY_TIME_INVALID") }
        let (whole, multipliedOverflow) = seconds.multipliedReportingOverflow(by: 10_000_000)
        let (fractional, addedOverflow) = whole.addingReportingOverflow(microseconds * 10)
        let (ticks, epochOverflow) = fractional.addingReportingOverflow(unixEpochTicks)
        guard !multipliedOverflow, !addedOverflow, !epochOverflow else { throw HostError.code("PROCESS_IDENTITY_TIME_INVALID") }
        return ticks
    }
}
