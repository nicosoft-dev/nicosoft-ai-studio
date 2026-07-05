#include "server/Server.h"

#include <windows.h>
#include <objbase.h>

#include <cstdio>
#include <stdexcept>

#include "accessibility/UiaTree.h"
#include "capture/ImageEncoder.h"
#include "capture/ScreenCapture.h"
#include "input/InputSynthesizer.h"
#include "support/Version.h"

namespace nicosoft {
namespace {

// Fixed per-machine pipe, overridable via NSAI_CUA_PIPE (mirrors the macOS
// helper's NSAI_CUA_SOCKET override).
std::wstring resolvePipeName() {
  std::wstring name = L"\\\\.\\pipe\\nicosoft_nscu";
  wchar_t buf[512];
  DWORD n = GetEnvironmentVariableW(L"NSAI_CUA_PIPE", buf, 512);
  if (n > 0 && n < 512) name.assign(buf, n);
  return name;
}

}  // namespace

Server::Server() : pipeName_(resolvePipeName()) {
  // Hold the process in a multithreaded apartment for the helper's whole
  // lifetime. C++/WinRT caches activation factories per-process; each
  // per-connection thread briefly joins/leaves the MTA, and if the last
  // CoUninitialize tore the MTA down it would invalidate that cache — the next
  // WGC capture would then dereference a stale factory and crash. Keeping one
  // reference here anchors the MTA (and the cache) until the helper exits.
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  // P0: liveness probe. Same result shape as the macOS helper's `ping`.
  rpc_.on("ping", [](const json&) -> json {
    return json{{"name", kName}, {"pong", true}, {"version", kVersion}};
  });

  // Capture one frame of the primary monitor → base64 PNG (full resolution; the
  // Studio side downscales and maps coordinates, as on macOS).
  rpc_.on("screenshot", [](const json&) -> json {
    CapturedFrame frame;
    if (!capturePrimaryMonitor(frame)) throw std::runtime_error("screen capture failed");
    std::string png =
        encodePngBase64(frame.bgra.data(), frame.width, frame.height, frame.rowPitch);
    return json{{"pngBase64", png},
                {"width", frame.width},
                {"height", frame.height},
                {"scale", 1.0}};
  });

  // Input synthesis (SendInput). Coordinate-based for P1; element-index
  // targeting arrives with UI Automation in a later batch.
  rpc_.on("perform_action", [](const json& p) -> json {
    const std::string action = p.value("action", std::string());
    int x = p.value("x", 0);
    int y = p.value("y", 0);
    // Element-index targeting (from ui_tree): resolve to the element's center.
    if (p.contains("index") && p["index"].is_number_integer()) {
      int cx = 0, cy = 0;
      if (!uia::elementCenter(p["index"].get<int>(), cx, cy))
        throw std::runtime_error("element index not found or off-screen");
      x = cx;
      y = cy;
    }
    if (action == "click") {
      input::click(x, y, p.value("button", std::string("left")), p.value("count", 1));
    } else if (action == "move") {
      input::moveMouse(x, y);
    } else if (action == "type" || action == "type_text") {
      input::typeText(p.value("text", std::string()));
    } else if (action == "key") {
      const std::string key = p.value("key", std::string());
      if (!input::pressKey(key)) throw std::runtime_error("unknown key: " + key);
    } else if (action == "scroll") {
      input::scroll(x, y, p.value("dx", 0), p.value("dy", 0));
    } else if (action == "drag") {
      input::drag(x, y, p.value("toX", x), p.value("toY", y),
                  p.value("button", std::string("left")));
    } else if (action == "wait") {
      Sleep(static_cast<DWORD>(p.value("ms", 100)));
    } else {
      throw std::runtime_error("unknown action: " + action);
    }
    return json{{"ok", true}, {"action", action}};
  });

  // UI Automation: element tree + app/window enumeration.
  rpc_.on("ui_tree", [](const json& p) -> json { return uia::snapshot(p.value("pid", 0)); });
  rpc_.on("list_apps", [](const json&) -> json { return uia::listApps(); });
  rpc_.on("frontmost_window", [](const json&) -> json { return uia::frontmostWindow(); });

  listener_ = std::make_unique<NamedPipeListener>(
      pipeName_, [this](const std::string& line) { return rpc_.handleLine(line); });
}

void Server::run() {
  std::printf("%s %s ready \xE2\x80\x94 pipe %ls\n", kName, kVersion, pipeName_.c_str());
  std::fflush(stdout);
  listener_->run();  // blocks on the accept loop
}

Server::~Server() { CoUninitialize(); }

}  // namespace nicosoft
