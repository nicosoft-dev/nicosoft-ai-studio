import Darwin
import Foundation

/// Single-instance guard for the helper process.
///
/// The helper binds a fixed per-user socket, and `UnixSocketListener` unlink()s any existing socket file
/// first ("clear a crash's stale socket") — so, without a separate lock, a second launch fired before the
/// previous instance had died would steal the socket path and BOTH would run (user report 2026-07-11).
/// The guard is an exclusive advisory lock on a lock file beside the socket, held for the whole process
/// lifetime. A second instance can't acquire it and exits cleanly. The lock fd is intentionally leaked:
/// the kernel drops the lock when the process exits — clean OR crash — so there is no stale-lock problem a
/// PID file would have. The lock path derives from the socket, so the singleton scope matches the endpoint
/// scope (an `NSAI_CUA_SOCKET` override — tests — gets its own independent lock).
enum SingleInstance {
    /// Acquire the exclusive lock at `lockPath`, or exit the process:
    /// - already held by a live instance → `exit(0)` (a backoff, not an error);
    /// - the lock file can't be opened → `exit(1)`.
    /// On success the lock fd is held for the process lifetime (never closed).
    static func acquireOrExit(lockPath: String) {
        try? FileManager.default.createDirectory(
            atPath: (lockPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true
        )
        let fd = open(lockPath, O_CREAT | O_RDWR, 0o600)
        if fd < 0 {
            Log.error("failed to open lock file \(lockPath): \(String(cString: strerror(errno)))")
            exit(1)
        }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            // EWOULDBLOCK = another live instance already holds it. Not an error — the guard is working.
            Log.info("another \(Version.displayName) instance already holds \(lockPath) — exiting")
            exit(0)
        }
        // `fd` is deliberately leaked — held for the process lifetime so the lock persists.
    }
}
