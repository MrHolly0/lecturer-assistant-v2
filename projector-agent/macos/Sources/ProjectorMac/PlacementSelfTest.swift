import AppKit
import Foundation
import Darwin

@MainActor final class PlacementSelfTest: NSObject, NSApplicationDelegate {
    private let reportURL: URL
    private var diagnostics: [String: Any] = [:]
    init(reportURL: URL) { self.reportURL = reportURL }
    static func run(reportURL: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = PlacementSelfTest(reportURL: reportURL); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async { [self] in
            var result: [String: Any]; var status: Int32 = 0
            do { result = try exercise() }
            catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
            catch { result = ["success": false, "code": "PLACEMENT_FIXTURE_FAILED"]; status = 1 }
            if status != 0 { result["diagnostics"] = diagnostics }
            do {
                try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
    }
    private func exercise() throws -> [String: Any] {
        let cases: [(String, NSRect)] = [
            ("primary-landscape", NSRect(x: 0, y: 0, width: 2560, height: 1440)),
            ("reported-left-portrait", NSRect(x: -1440, y: -546, width: 1440, height: 2560)),
            ("right-portrait", NSRect(x: 2560, y: -320, width: 1080, height: 1920)),
            ("above", NSRect(x: -480, y: 1440, width: 1920, height: 1080)),
            ("below", NSRect(x: 0, y: -2160, width: 3840, height: 2160)),
            ("negative-landscape", NSRect(x: -3840, y: -1200, width: 3840, height: 2160)),
            ("small-landscape", NSRect(x: 2560, y: 0, width: 640, height: 480))
        ]
        var windows: [NSWindow] = []
        defer { windows.forEach { $0.close() } }
        let providedScreen = NSScreen.screens.last
        var checked: [[String: Any]] = []
        let longName = "Внешний вертикальный монитор — DisplayPort / HDMI · 27-inch Ultra High Definition"
        for (index, entry) in cases.enumerated() {
            let (name, screenFrame) = entry
            let projection = DisplayWindowPlacement.projection(frame: screenFrame, screen: providedScreen); windows.append(projection)
            guard equal(projection.frame, screenFrame), !projection.isVisible else { throw HostError.code("PLACEMENT_PROJECTION_" + name.uppercased()) }
            let overlay = DisplayWindowPlacement.identification(frame: screenFrame, screen: providedScreen, number: index == 6 ? 16 : index + 1, name: longName); windows.append(overlay)
            diagnostics = ["case": name, "screen": rectangle(screenFrame), "overlay": rectangle(overlay.frame), "projection": rectangle(projection.frame), "subviews": overlay.contentView?.subviews.map { ["id": $0.identifier?.rawValue ?? "none", "frame": rectangle($0.frame)] } ?? []]
            // AppKit rounds a half-point center for odd-sized frames to a backing pixel.
            guard abs(overlay.frame.midX - screenFrame.midX) <= 0.5, abs(overlay.frame.midY - screenFrame.midY) <= 0.5,
                  screenFrame.contains(overlay.frame), !overlay.isVisible,
                  let content = overlay.contentView,
                  let label = content.subviews.first(where: { $0.identifier?.rawValue == "display-name" }) as? NSTextField,
                  let number = content.subviews.first(where: { $0.identifier?.rawValue == "display-number" }) as? NSTextField else { throw HostError.code("PLACEMENT_IDENTIFICATION_" + name.uppercased()) }
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byWordWrapping
            let text = NSAttributedString(string: longName, attributes: [.font: label.font!, .paragraphStyle: paragraph])
            let textHeight = ceil(text.boundingRect(with: NSSize(width: label.frame.width - 4, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading]).height)
            guard label.stringValue == longName, label.maximumNumberOfLines == 0, label.cell?.wraps == true,
                  label.frame.height >= textHeight, content.bounds.contains(label.frame), content.bounds.contains(number.frame),
                  !label.frame.intersects(number.frame), number.font!.pointSize > label.font!.pointSize else { throw HostError.code("PLACEMENT_NAME_CLIPPED") }
            checked.append(["name": name, "screen": rectangle(screenFrame), "projection": rectangle(projection.frame), "identification": rectangle(overlay.frame), "nameUnclipped": true])
        }
        var actualScreens = 0
        for (index, screen) in NSScreen.screens.prefix(16).enumerated() {
            let projection = DisplayWindowPlacement.projection(frame: screen.frame, screen: screen); windows.append(projection)
            let overlay = DisplayWindowPlacement.identification(frame: screen.frame, screen: screen, number: index + 1, name: screen.localizedName); windows.append(overlay)
            guard equal(projection.frame, screen.frame), abs(overlay.frame.midX - screen.frame.midX) <= 0.5,
                  abs(overlay.frame.midY - screen.frame.midY) <= 0.5, !projection.isVisible, !overlay.isVisible else { throw HostError.code("PLACEMENT_REAL_SCREEN_FRAME") }
            actualScreens += 1
        }
        for id in ["__placement_fixture_invalid__", DisplayController.screenID(CGMainDisplayID())] {
            do { try ProjectionWindow().test(screenID: id, code: "LOCAL-TEST"); throw HostError.code("PLACEMENT_TARGET_GUARD_MISSING") }
            catch HostError.code(let code) { guard code == "TARGET_NOT_INDEPENDENT_EXTERNAL" else { throw HostError.code(code) } }
        }
        guard windows.allSatisfy({ !$0.isVisible }) else { throw HostError.code("PLACEMENT_FIXTURE_VISIBLE_WINDOW") }
        return ["success": true, "cases": checked, "actualScreenFramesChecked": actualScreens,
                "invalidAndPrimaryTargetsRejected": true, "allWindowsHidden": true, "fixtureCleaned": true,
                "screenCaptured": false, "projectionStarted": false, "displaySettingsChanged": false,
                "pairingChanged": false, "networkUsed": false, "productionSchemeChanged": false]
    }
    private func equal(_ left: NSRect, _ right: NSRect) -> Bool {
        abs(left.minX - right.minX) < 0.5 && abs(left.minY - right.minY) < 0.5 && abs(left.width - right.width) < 0.5 && abs(left.height - right.height) < 0.5
    }
    private func rectangle(_ frame: NSRect) -> [String: CGFloat] { ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height] }
}
