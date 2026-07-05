#pragma once
//
// Input synthesis via SendInput — the Windows counterpart of the macOS helper's
// CGEvent-based InputSynthesizer. Coordinates are physical pixels (same space
// as the WGC screenshot). Text entry goes through the clipboard + Ctrl+V so it
// is IME-independent and language-agnostic (mirrors the macOS ⌘V approach).
#include <string>

namespace nicosoft {
namespace input {

void moveMouse(int x, int y);
void click(int x, int y, const std::string& button, int count);
void drag(int x1, int y1, int x2, int y2, const std::string& button);
void scroll(int x, int y, int dx, int dy);

// Paste UTF-8 text via the clipboard (Ctrl+V) into the foreground window.
void typeText(const std::string& utf8);

// Press a key or chord like "Return", "ctrl+a", "super+d". Returns false if the
// main key name is unrecognized.
bool pressKey(const std::string& spec);

}  // namespace input
}  // namespace nicosoft
