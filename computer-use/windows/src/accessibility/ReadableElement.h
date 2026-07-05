#pragma once
//
// A flattened, serializable accessibility element — the Windows counterpart of
// the macOS helper's ReadableElement. Roles are normalized to the same "AX…"
// strings the macOS tree emits, so the Studio-side formatter is platform-neutral.
#include <string>

#include "ipc/JsonRpc.h"

namespace nicosoft {

struct ReadableElement {
  int index = 0;
  std::string role;   // normalized, e.g. "AXButton", "AXTextArea"
  std::string name;   // UIA Name
  std::string value;  // ValuePattern value, when present
  bool hasFrame = false;
  double x = 0, y = 0, w = 0, h = 0;  // physical pixels
  bool focused = false;
  int pid = 0;
};

inline json toJson(const ReadableElement& e) {
  json j{{"index", e.index}, {"role", e.role}};
  if (!e.name.empty()) j["name"] = e.name;
  if (!e.value.empty()) j["value"] = e.value;
  if (e.focused) j["focused"] = true;
  if (e.hasFrame) {
    j["frame"] = json{{"x", e.x}, {"y", e.y}, {"width", e.w}, {"height", e.h}};
  }
  return j;
}

}  // namespace nicosoft
