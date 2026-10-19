import AppKit
import Foundation
import Darwin

@MainActor final class ConnectionForm {
    let alert = NSAlert()
    let address = NSTextField(string: "")
    let code = NSTextField(string: "")
    let labels = ["Адрес сайта учреждения", "Код подключения помощника · 12 символов"]
    static let instructions = "Откройте «Настройка проектора» на сайте Lecturer Assistant и получите код подключения этого компьютера. Это не код занятия со слайда. Пароль аккаунта помощнику не нужен."
    init(origin: String) {
        alert.messageText = "Подключить помощник проектора"
        alert.informativeText = Self.instructions
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        address.stringValue = origin; address.placeholderString = "https://адрес-учреждения/"
        code.placeholderString = "Например, A1B2C3D4E5F6"
        for (name, field) in zip(labels, [address, code]) {
            let label = NSTextField(labelWithString: name); label.font = .systemFont(ofSize: 13, weight: .semibold)
            stack.addArrangedSubview(label)
            field.frame.size = NSSize(width: 420, height: 28); field.widthAnchor.constraint(equalToConstant: 420).isActive = true
            stack.addArrangedSubview(field)
        }
        let hint = NSTextField(wrappingLabelWithString: "Нужен одноразовый код помощника из настройки проектора, не короткий код для студентов.")
        hint.font = .systemFont(ofSize: 12); hint.textColor = .secondaryLabelColor
        hint.widthAnchor.constraint(equalToConstant: 420).isActive = true; stack.addArrangedSubview(hint)
        stack.frame = NSRect(x: 0, y: 0, width: 420, height: 170); alert.accessoryView = stack
        alert.addButton(withTitle: "Подключить"); alert.addButton(withTitle: "Позже")
        alert.window.initialFirstResponder = origin.isEmpty ? address : code
    }
    static func normalizedCode(_ raw: String) -> String { raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
    static func validCode(_ raw: String) -> Bool {
        let value = normalizedCode(raw)
        return value.count == 12 && value.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) }
    }
    func validationError(_ message: String) {
        alert.informativeText = message + "\n\n" + Self.instructions
        alert.window.initialFirstResponder = code
    }
    static func exerciseLocalFixture() throws -> [String: Any] {
        let form = ConnectionForm(origin: "https://school.example/")
        let previous = NSWorkspace.shared.frontmostApplication
        defer { form.alert.window.close(); previous?.activate(options: []) }
        form.alert.layout(); form.alert.window.center(); form.alert.window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        guard form.alert.window.makeFirstResponder(form.code), let editor = form.code.currentEditor() as? NSTextView else { throw HostError.code("CONNECTION_FIXTURE_FOCUS") }
        editor.insertText("abcd1234efgh", replacementRange: NSRange(location: NSNotFound, length: 0))
        form.alert.window.makeFirstResponder(form.address)
        guard normalizedCode(form.code.stringValue) == "ABCD1234EFGH", validCode(form.code.stringValue), !validCode("NUQ9T7") else { throw HostError.code("CONNECTION_FIXTURE_HELPER_CODE") }
        form.validationError("Нужен код помощника из 12 символов.")
        guard form.alert.informativeText.contains("12"), form.alert.window.isVisible,
              form.address.frame.width > 300, form.code.frame.width > 300 else { throw HostError.code("CONNECTION_FIXTURE_VISIBLE_FORM") }
        return ["success": true, "labels": form.labels, "nativeTextInput": true, "helperCodeLength": 12, "lectureCodeRejected": true,
                "validationKeepsFormVisible": true, "networkUsed": false, "keychainChanged": false, "displaySettingsChanged": false, "installed": false]
    }
}

@MainActor final class ConnectionSelfTest: NSObject, NSApplicationDelegate {
    let reportURL: URL
    init(reportURL: URL) { self.reportURL = reportURL }
    static func run(reportURL: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = ConnectionSelfTest(reportURL: reportURL); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async { [self] in
            let report: [String: Any], result: Int32
            do { report = try ConnectionForm.exerciseLocalFixture(); result = 0 }
            catch HostError.code(let code) { report = ["success": false, "code": code]; result = 1 }
            catch { report = ["success": false, "code": "CONNECTION_FIXTURE_FAILED"]; result = 1 }
            do {
                let bytes = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try bytes.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(bytes + Data([10]))
            } catch { exit(2) }
            exit(result)
        }
    }
}
