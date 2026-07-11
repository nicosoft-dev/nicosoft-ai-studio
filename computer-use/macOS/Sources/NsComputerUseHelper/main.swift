import AppKit

// MARK: - Entry point
//
// A long-lived accessory application: an AppKit run loop on the main thread drives the overlay window and
// the Esc monitor, while the JSON-RPC server accepts connections on its own background queue. Each step's
// detail lives in a Support/ type; this file is just the wiring.

let socketPath = SocketPath.resolve()

// Refuse a second launch (a raced `open -g`, or a relaunch before the previous instance died) — one
// helper per socket endpoint. Exits cleanly if another instance already holds the lock.
SingleInstance.acquireOrExit(lockPath: socketPath + ".lock")

let server = Server(socketPath: socketPath)
do {
    try server.start()
} catch {
    Log.error("failed to start: \(error)")
    exit(1)
}
Log.info("\(Version.displayName) \(Version.string) ready — socket \(socketPath)")

// SIGINT/SIGTERM → stop the server (removes the socket) and exit; SIGPIPE ignored.
SignalHandlers.install(stopping: server)

// Accessory policy: no Dock icon, but the overlay window may still appear. When packaged, Info.plist's
// LSUIElement=true has the same effect.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.run()
