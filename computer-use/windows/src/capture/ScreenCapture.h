#pragma once
//
// Screen capture via Windows.Graphics.Capture (WGC). The counterpart of macOS's
// ScreenCaptureKit path. A single frame of the primary monitor is grabbed on
// demand; streaming (start/next/stop) comes in a later batch.
#include <cstdint>
#include <vector>

namespace nicosoft {

// One captured frame, BGRA, row-major with `rowPitch` bytes per row (rowPitch
// may exceed width*4 due to GPU alignment). `bgra` holds rowPitch*height bytes.
struct CapturedFrame {
  std::vector<uint8_t> bgra;
  int width = 0;
  int height = 0;
  int rowPitch = 0;
};

// Capture one frame of the primary monitor. Returns false on failure.
// The calling thread must be in a COM MTA (see NamedPipeListener::serveClient).
bool capturePrimaryMonitor(CapturedFrame& out);

}  // namespace nicosoft
