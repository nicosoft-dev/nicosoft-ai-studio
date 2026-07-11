#pragma once

// Single-instance guard for the helper process — the mutex ("互斥体") counterpart of the macOS flock
// (Support/SingleInstance.swift).
//
// A second launch (a raced spawn, or a relaunch fired before the previous instance exited) would fight
// the running one over the named pipe. The guard is a named mutex the sole instance owns: a second
// instance sees ERROR_ALREADY_EXISTS and backs off. Local\ (session namespace) matches the
// per-interactive-session helper the overlay/WGC model needs. The handle is held for the process lifetime
// (leaked intentionally — Windows releases the named object when the process exits, clean or crash), so
// there is no stale-lock problem a PID file would have.

#include <windows.h>

#include <cstdio>
#include <cstdlib>

namespace nicosoft {

// Acquire the single-instance mutex, or exit the process:
//   another instance already owns it → exit(0) (a backoff, not an error);
//   the mutex can't be created       → exit(1).
// On success the handle is held for the process lifetime (never closed).
inline void acquireSingleInstanceOrExit() {
  HANDLE singleton = CreateMutexW(nullptr, TRUE, L"Local\\NsComputerUseHelper.singleton");
  if (singleton == nullptr) {
    std::fprintf(stderr, "failed to create singleton mutex: %lu\n", GetLastError());
    std::exit(1);
  }
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    std::fprintf(stderr, "another NsComputerUseHelper instance is already running — exiting\n");
    std::exit(0);
  }
  // `singleton` is deliberately leaked — held for the process lifetime so the guard persists.
}

}  // namespace nicosoft
