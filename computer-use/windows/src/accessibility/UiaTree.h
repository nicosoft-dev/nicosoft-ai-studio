#pragma once
//
// UI Automation tree access — the Windows counterpart of macOS's AXTree.
// snapshot() flattens the target window's element subtree (foreground window by
// default, or the given pid's main window) into the same shape the macOS
// ui_tree returns, and fills ElementRegistry so perform_action can target an
// element by index. Uses a CacheRequest to batch property reads (UIA cross-
// process calls are slow one-by-one).
#include "ipc/JsonRpc.h"

namespace nicosoft {
namespace uia {

// {pid, count, elements:[{index, role, name?, value?, focused?, frame?}]}.
// Throws on failure. Requires a COM-initialized (MTA) thread.
json snapshot(int pid /* 0 = foreground window */);

// {title, pid, app, bundleId, frame} of the OS foreground window.
json frontmostWindow();

// [{pid, name, bundleId, frontmost}] for visible, titled, top-level windows.
json listApps();

// Center of the element at `index` (live bounding rect), in physical pixels.
// Returns false if the index is unknown or the element has no on-screen rect.
bool elementCenter(int index, int& x, int& y);

}  // namespace uia
}  // namespace nicosoft
