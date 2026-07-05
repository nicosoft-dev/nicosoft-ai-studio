#pragma once
//
// Key-name → Windows virtual-key mapping, the Windows counterpart of the macOS
// helper's KeyCodes.swift. Accepts the same friendly names the agent uses
// (Return, Tab, Escape, arrows, F1-F24, modifiers, single characters).
#include <cstdint>
#include <string>

namespace nicosoft {
namespace input {

// Returns the VK code for a key name (case-insensitive), or 0 if unknown.
// Single-character names ("a", "5", "/") are resolved via the keyboard layout.
uint16_t keyNameToVk(const std::string& name);

// True if the name denotes a modifier (ctrl/alt/shift/super/win/cmd/meta).
bool isModifierName(const std::string& name);

}  // namespace input
}  // namespace nicosoft
