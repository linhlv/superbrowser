import Carbon.HIToolbox
import SuperbrowserCore

/// 'SBRW': tags our hot keys so the handler ignores anyone else's.
private let hotKeySignature: OSType = 0x5342_5257

/// Carbon event handler for `kEventHotKeyPressed`; runs on the main thread and hands the slot to the main actor.
private func hotKeyPressed(_ call: EventHandlerCallRef?, _ event: EventRef?, _ userData: UnsafeMutableRawPointer?) -> OSStatus {
    guard let event else { return OSStatus(eventNotHandledErr) }
    var id = EventHotKeyID()
    let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                   nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
    guard status == noErr, id.signature == hotKeySignature else { return OSStatus(eventNotHandledErr) }
    let slot = Int(id.id)
    Task { @MainActor in Hotkeys.current?.onSlot(slot) }
    return noErr
}

/// Global ⌃1…9 (or ⌃⌥ / ⌃⌘) shortcuts via Carbon `RegisterEventHotKey`; they work from any app and any desktop.
@MainActor final class Hotkeys {
    /// Virtual key codes for the digits 1…9 (ANSI layout).
    private static let keyCodes: [UInt32] = [18, 19, 20, 21, 23, 22, 26, 28, 25]
    /// The one live instance the C handler forwards to.
    fileprivate static weak var current: Hotkeys?

    fileprivate let onSlot: (Int) -> Void
    private var handler: EventHandlerRef?
    private var registered: [EventHotKeyRef] = []

    init(onSlot: @escaping (Int) -> Void) {
        self.onSlot = onSlot
        Self.current = self
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), hotKeyPressed, 1, &spec, nil, &handler)
        if status != noErr {
            FileHandle.standardError.write(Data("Superbrowser: InstallEventHandler failed (\(status))\n".utf8))
        }
    }

    isolated deinit {
        unregisterAll()
        if let handler { RemoveEventHandler(handler) }
    }

    /// Replaces the current set of hot keys. Returns the slots (1…9) the system refused.
    func register(modifier: HotkeyModifier) -> [Int] {
        unregisterAll()
        let mods: UInt32 = switch modifier {
        case .control: UInt32(controlKey)
        case .controlOption: UInt32(controlKey | optionKey)
        case .controlCommand: UInt32(controlKey | cmdKey)
        }
        var failed: [Int] = []
        for (i, code) in Self.keyCodes.enumerated() {
            let slot = i + 1
            var ref: EventHotKeyRef?
            let status = RegisterEventHotKey(code, mods, EventHotKeyID(signature: hotKeySignature, id: UInt32(slot)),
                                             GetApplicationEventTarget(), 0, &ref)
            if status == noErr, let ref { registered.append(ref) } else { failed.append(slot) }
        }
        return failed
    }

    private func unregisterAll() {
        for ref in registered { UnregisterEventHotKey(ref) }
        registered = []
    }
}
