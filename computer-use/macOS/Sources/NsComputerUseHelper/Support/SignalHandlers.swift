import Darwin
import Foundation

/// Clean-shutdown signal handling. SIGINT/SIGTERM stop the server (which removes the socket file) and
/// exit(0). A plain C signal handler can do very little safely, so each signal is routed through a GCD
/// dispatch source on the main queue instead. Also ignores SIGPIPE, so a write to a peer that closed the
/// socket never kills the process.
enum SignalHandlers {
    /// Retained for the process lifetime so the GCD sources aren't cancelled by deallocation.
    private static var sources: [DispatchSourceSignal] = []

    /// Ignore SIGPIPE and install clean-shutdown handlers for SIGINT/SIGTERM that stop `server` and exit.
    static func install(stopping server: Server) {
        signal(SIGPIPE, SIG_IGN)
        for sig in [SIGINT, SIGTERM] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler {
                Log.info("received signal \(sig) — shutting down")
                server.stop()
                exit(0)
            }
            source.resume()
            sources.append(source)
        }
    }
}
