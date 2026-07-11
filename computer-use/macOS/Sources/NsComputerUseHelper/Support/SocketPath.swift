import Foundation

/// Where the helper listens. `NSAI_CUA_SOCKET` overrides it (tests point it at a throwaway path); the
/// default is a fixed per-user path under ~/.nsai/computer-use/ that keeps the TCC grant stable across
/// launches. The single-instance lock derives from this, so the guard's scope matches the endpoint's.
enum SocketPath {
    static func resolve() -> String {
        if let env = ProcessInfo.processInfo.environment["NSAI_CUA_SOCKET"], !env.isEmpty {
            return (env as NSString).expandingTildeInPath
        }
        return NSHomeDirectory() + "/.nsai/computer-use/sock/nscu.sock"
    }
}
