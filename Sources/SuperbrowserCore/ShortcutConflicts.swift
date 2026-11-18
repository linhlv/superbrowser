import Foundation

/// Desktop numbers (1...9) whose "Switch to Desktop N" system shortcut is enabled
/// with exactly the modifier mask Superbrowser would use.
public func desktopShortcutConflicts(symbolicHotKeys: [String: Any], modifier: HotkeyModifier) -> [Int] {
    let mask: Int
    switch modifier {
    case .control: mask = 262144
    case .controlOption: mask = 786432
    case .controlCommand: mask = 1310720
    }
    var result: [Int] = []
    for n in 1...9 {
        guard let entry = symbolicHotKeys[String(117 + n)] as? [String: Any],
              (entry["enabled"] as? NSNumber)?.intValue == 1,
              let value = entry["value"] as? [String: Any],
              let params = value["parameters"] as? [Any], params.count > 2,
              (params[2] as? NSNumber)?.intValue == mask else { continue }
        result.append(n)
    }
    return result
}
