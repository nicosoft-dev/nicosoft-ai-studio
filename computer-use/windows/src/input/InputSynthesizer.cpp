#include "input/InputSynthesizer.h"

#include <windows.h>

#include <cstring>
#include <vector>

#include "input/KeyCodes.h"

namespace nicosoft {
namespace input {
namespace {

// Map physical pixels to the 0..65535 absolute range over the whole virtual
// desktop (multi-monitor aware).
void absCoord(int x, int y, LONG& ax, LONG& ay) {
  int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
  int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (vw < 2) vw = 2;
  if (vh < 2) vh = 2;
  ax = (LONG)((x - vx) * 65535.0 / (vw - 1) + 0.5);
  ay = (LONG)((y - vy) * 65535.0 / (vh - 1) + 0.5);
}

void mouseButtonFlags(const std::string& button, DWORD& down, DWORD& up) {
  if (button == "right") {
    down = MOUSEEVENTF_RIGHTDOWN;
    up = MOUSEEVENTF_RIGHTUP;
  } else if (button == "middle") {
    down = MOUSEEVENTF_MIDDLEDOWN;
    up = MOUSEEVENTF_MIDDLEUP;
  } else {
    down = MOUSEEVENTF_LEFTDOWN;
    up = MOUSEEVENTF_LEFTUP;
  }
}

void keyEvent(uint16_t vk, bool up) {
  INPUT in{};
  in.type = INPUT_KEYBOARD;
  in.ki.wVk = vk;
  in.ki.wScan = (WORD)MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
  in.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
  SendInput(1, &in, sizeof(INPUT));
}

}  // namespace

void moveMouse(int x, int y) {
  INPUT in{};
  in.type = INPUT_MOUSE;
  absCoord(x, y, in.mi.dx, in.mi.dy);
  in.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
  SendInput(1, &in, sizeof(INPUT));
}

void click(int x, int y, const std::string& button, int count) {
  moveMouse(x, y);
  DWORD down, up;
  mouseButtonFlags(button, down, up);
  if (count < 1) count = 1;
  for (int i = 0; i < count; ++i) {
    INPUT ev[2]{};
    ev[0].type = INPUT_MOUSE;
    ev[0].mi.dwFlags = down;
    ev[1].type = INPUT_MOUSE;
    ev[1].mi.dwFlags = up;
    SendInput(2, ev, sizeof(INPUT));
  }
}

void drag(int x1, int y1, int x2, int y2, const std::string& button) {
  DWORD down, up;
  mouseButtonFlags(button, down, up);
  moveMouse(x1, y1);
  INPUT d{};
  d.type = INPUT_MOUSE;
  d.mi.dwFlags = down;
  SendInput(1, &d, sizeof(INPUT));
  Sleep(30);
  moveMouse(x2, y2);
  Sleep(30);
  INPUT u{};
  u.type = INPUT_MOUSE;
  u.mi.dwFlags = up;
  SendInput(1, &u, sizeof(INPUT));
}

void scroll(int x, int y, int dx, int dy) {
  moveMouse(x, y);
  if (dy != 0) {
    INPUT in{};
    in.type = INPUT_MOUSE;
    in.mi.dwFlags = MOUSEEVENTF_WHEEL;
    in.mi.mouseData = (DWORD)(dy * WHEEL_DELTA);
    SendInput(1, &in, sizeof(INPUT));
  }
  if (dx != 0) {
    INPUT in{};
    in.type = INPUT_MOUSE;
    in.mi.dwFlags = MOUSEEVENTF_HWHEEL;
    in.mi.mouseData = (DWORD)(dx * WHEEL_DELTA);
    SendInput(1, &in, sizeof(INPUT));
  }
}

void typeText(const std::string& utf8) {
  if (utf8.empty()) return;

  int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), (int)utf8.size(), nullptr, 0);
  std::wstring w((size_t)wlen, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), (int)utf8.size(), w.data(), wlen);

  if (OpenClipboard(nullptr)) {
    EmptyClipboard();
    size_t bytes = (w.size() + 1) * sizeof(wchar_t);
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (h) {
      void* p = GlobalLock(h);
      std::memcpy(p, w.c_str(), w.size() * sizeof(wchar_t));
      ((wchar_t*)p)[w.size()] = L'\0';
      GlobalUnlock(h);
      SetClipboardData(CF_UNICODETEXT, h);  // clipboard owns h now
    }
    CloseClipboard();
  }

  keyEvent(VK_CONTROL, false);
  keyEvent('V', false);
  keyEvent('V', true);
  keyEvent(VK_CONTROL, true);
}

bool pressKey(const std::string& spec) {
  std::vector<std::string> parts;
  size_t start = 0;
  for (size_t i = 0; i <= spec.size(); ++i) {
    if (i == spec.size() || spec[i] == '+') {
      if (i > start) parts.push_back(spec.substr(start, i - start));
      start = i + 1;
    }
  }
  if (parts.empty()) return false;

  uint16_t mainVk = keyNameToVk(parts.back());
  if (mainVk == 0) return false;

  std::vector<uint16_t> mods;
  for (size_t i = 0; i + 1 < parts.size(); ++i) {
    uint16_t m = keyNameToVk(parts[i]);
    if (m) mods.push_back(m);
  }

  for (uint16_t m : mods) keyEvent(m, false);
  keyEvent(mainVk, false);
  keyEvent(mainVk, true);
  for (auto it = mods.rbegin(); it != mods.rend(); ++it) keyEvent(*it, true);
  return true;
}

}  // namespace input
}  // namespace nicosoft
