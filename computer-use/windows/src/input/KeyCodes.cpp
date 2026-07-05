#include "input/KeyCodes.h"

#include <windows.h>

#include <algorithm>
#include <unordered_map>

namespace nicosoft {
namespace input {
namespace {

std::string lower(const std::string& s) {
  std::string out = s;
  std::transform(out.begin(), out.end(), out.begin(),
                 [](unsigned char c) { return (char)std::tolower(c); });
  return out;
}

const std::unordered_map<std::string, uint16_t>& table() {
  static const std::unordered_map<std::string, uint16_t> kMap = {
      {"return", VK_RETURN},   {"enter", VK_RETURN},    {"tab", VK_TAB},
      {"escape", VK_ESCAPE},   {"esc", VK_ESCAPE},      {"space", VK_SPACE},
      {"backspace", VK_BACK},  {"delete", VK_DELETE},   {"del", VK_DELETE},
      {"insert", VK_INSERT},   {"home", VK_HOME},       {"end", VK_END},
      {"pageup", VK_PRIOR},    {"pgup", VK_PRIOR},      {"pagedown", VK_NEXT},
      {"pgdn", VK_NEXT},       {"up", VK_UP},           {"down", VK_DOWN},
      {"left", VK_LEFT},       {"right", VK_RIGHT},     {"capslock", VK_CAPITAL},
      // Modifiers
      {"ctrl", VK_CONTROL},    {"control", VK_CONTROL}, {"alt", VK_MENU},
      {"option", VK_MENU},     {"shift", VK_SHIFT},     {"super", VK_LWIN},
      {"win", VK_LWIN},        {"cmd", VK_LWIN},        {"meta", VK_LWIN},
  };
  return kMap;
}

}  // namespace

uint16_t keyNameToVk(const std::string& name) {
  std::string key = lower(name);

  auto it = table().find(key);
  if (it != table().end()) return it->second;

  // Function keys F1-F24.
  if ((key.size() == 2 || key.size() == 3) && key[0] == 'f') {
    int n = std::atoi(key.c_str() + 1);
    if (n >= 1 && n <= 24) return (uint16_t)(VK_F1 + (n - 1));
  }

  // Single character: resolve through the active keyboard layout.
  if (name.size() == 1) {
    SHORT vk = VkKeyScanA(name[0]);
    if (vk != -1) return (uint16_t)(vk & 0xFF);
  }
  return 0;
}

bool isModifierName(const std::string& name) {
  std::string key = lower(name);
  return key == "ctrl" || key == "control" || key == "alt" || key == "option" ||
         key == "shift" || key == "super" || key == "win" || key == "cmd" || key == "meta";
}

}  // namespace input
}  // namespace nicosoft
