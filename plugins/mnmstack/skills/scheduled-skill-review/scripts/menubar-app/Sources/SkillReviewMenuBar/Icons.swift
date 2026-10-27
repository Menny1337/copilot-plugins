import AppKit
import SwiftUI

struct StateIcon {
    let image: NSImage?
    let fallbackEmoji: String
}

struct IconLoader {
    static func icon(for state: DaemonState) -> StateIcon {
        guard let image = loadImage(named: state.rawValue) else {
            return StateIcon(image: nil, fallbackEmoji: state.fallbackEmoji)
        }
        image.size = NSSize(width: 18, height: 18)
        image.isTemplate = state == .idle
        return StateIcon(image: image, fallbackEmoji: state.fallbackEmoji)
    }

    private static func loadImage(named name: String) -> NSImage? {
        if let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "icons"), let image = NSImage(contentsOf: url) {
            return image
        }

        let resourceURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents")
            .appendingPathComponent("Resources")
            .appendingPathComponent("icons")
            .appendingPathComponent("\(name).png")
        return NSImage(contentsOf: resourceURL)
    }
}

struct StateIconView: View {
    let state: DaemonState

    var body: some View {
        let icon = IconLoader.icon(for: state)
        if let image = icon.image {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
                .accessibilityLabel(Text(state.rawValue))
        } else {
            Text(icon.fallbackEmoji)
                .accessibilityLabel(Text(state.rawValue))
        }
    }
}
