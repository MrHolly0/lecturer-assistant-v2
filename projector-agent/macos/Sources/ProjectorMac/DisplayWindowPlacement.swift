import AppKit

/// AppKit screen frames and setFrame use the global desktop coordinate space.
/// The screen-specific initializer instead interprets its origin relative to that screen.
@MainActor enum DisplayWindowPlacement {
    static func projection(frame: NSRect, screen: NSScreen?) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: frame.size), styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
        window.setFrame(frame, display: false)
        window.backgroundColor = .black; window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .stationary]
        window.isReleasedWhenClosed = false
        return window
    }

    static func identification(frame: NSRect, screen: NSScreen?, number: Int, name: String) -> NSPanel {
        let padding: CGFloat = 24, gap: CGFloat = 12
        let width = min(360, max(1, frame.width - 32))
        let textWidth = max(1, width - padding * 2)
        let numberLabel = NSTextField(labelWithString: String(number))
        numberLabel.font = .systemFont(ofSize: 88, weight: .bold); numberLabel.alignment = .center
        numberLabel.identifier = NSUserInterfaceItemIdentifier("display-number")
        let nameLabel = NSTextField(wrappingLabelWithString: name)
        nameLabel.font = .systemFont(ofSize: 18, weight: .medium); nameLabel.alignment = .center
        nameLabel.maximumNumberOfLines = 0; nameLabel.lineBreakMode = .byWordWrapping
        nameLabel.identifier = NSUserInterfaceItemIdentifier("display-name"); nameLabel.toolTip = name
        let numberHeight: CGFloat = 108
        let nameHeight = ceil(nameLabel.cell!.cellSize(forBounds: NSRect(x: 0, y: 0, width: textWidth, height: 10000)).height) + 4
        let height = padding * 2 + numberHeight + gap + nameHeight
        let globalFrame = NSRect(x: frame.midX - width / 2, y: frame.midY - height / 2, width: width, height: height)
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: globalFrame.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false, screen: screen)
        panel.setFrame(globalFrame, display: false)
        panel.isOpaque = false; panel.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96)
        panel.level = .screenSaver; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.ignoresMouseEvents = true; panel.isReleasedWhenClosed = false
        panel.contentView?.wantsLayer = true; panel.contentView?.layer?.cornerRadius = 16
        nameLabel.frame = NSRect(x: padding, y: padding, width: textWidth, height: nameHeight)
        numberLabel.frame = NSRect(x: padding, y: padding + nameHeight + gap, width: textWidth, height: numberHeight)
        panel.contentView?.addSubview(numberLabel); panel.contentView?.addSubview(nameLabel)
        return panel
    }
}
