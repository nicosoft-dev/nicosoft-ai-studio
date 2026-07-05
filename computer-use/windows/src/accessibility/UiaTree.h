#pragma once
//
// UI Automation tree access — the Windows counterpart of macOS's AXTree, with
// the same window-aware + focus/frontmost-aware behavior that fixed multi-window
// apps (WeChat, etc.) on macOS:
//   * snapshot() is scoped to ONE window (foreground, the pid's main window, or
//     an explicit window index from list_windows) — UIA is naturally per-HWND.
//   * list_windows() enumerates an app's top-level windows so a caller can lock
//     onto the main window and avoid floating pop-outs.
//   * focus helpers let perform_action's typing target the RIGHT field: paste
//     (Ctrl+V) only when the element is focused AND its app is foreground,
//     otherwise write the value directly via the Value pattern.
#include "ipc/JsonRpc.h"

#include <string>

namespace nicosoft {
namespace uia {

// {pid, count, window?, windowTitle?, elements:[…]}. windowIndex < 0 selects
// the pid's main window (pid>0) or the foreground window (pid==0).
json snapshot(int pid, int windowIndex);

json frontmostWindow();
json listApps();

// [{index, title, frame, main, focused, minimized}] for the app's top-level
// windows. pid 0 = the foreground app.
json listWindows(int pid);

// Center of the element at `index` (live bounding rect), physical pixels.
bool elementCenter(int index, int& x, int& y);

// Focus/frontmost-aware typing support (element addressed by ui_tree index).
bool focusElement(int index);            // UIA SetFocus
bool elementHasKeyboardFocus(int index); // element currently has keyboard focus
bool elementAppIsForeground(int index);  // element's process owns the foreground window
bool setElementValue(int index, const std::string& utf8);  // Value pattern, frontmost-independent

}  // namespace uia
}  // namespace nicosoft
