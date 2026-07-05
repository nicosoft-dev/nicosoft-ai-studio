// System UIA headers first, in a clean environment (before any project header).
#include <windows.h>
#include <ole2.h>  // OLE interfaces UIAutomationCore.h needs (stripped by WIN32_LEAN_AND_MEAN)
#include <uiautomation.h>
#include <wrl/client.h>

#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#include "accessibility/ElementRegistry.h"
#include "accessibility/ReadableElement.h"
#include "accessibility/UiaTree.h"

namespace nicosoft {
namespace uia {
namespace {

using Microsoft::WRL::ComPtr;

void checkHr(HRESULT hr, const char* what) {
  if (FAILED(hr)) throw std::runtime_error(what);
}

std::string wideToUtf8(const wchar_t* w, int len) {
  if (!w || len <= 0) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w, len, nullptr, 0, nullptr, nullptr);
  std::string out((size_t)n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, len, out.data(), n, nullptr, nullptr);
  return out;
}
std::string bstrToUtf8(BSTR b) { return b ? wideToUtf8(b, (int)SysStringLen(b)) : std::string{}; }

std::string exeNameForPid(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return {};
  wchar_t buf[MAX_PATH];
  DWORD size = MAX_PATH;
  std::string name;
  if (QueryFullProcessImageNameW(h, 0, buf, &size)) {
    std::wstring full(buf, size);
    size_t slash = full.find_last_of(L"\\/");
    std::wstring base = (slash == std::wstring::npos) ? full : full.substr(slash + 1);
    name = wideToUtf8(base.c_str(), (int)base.size());
  }
  CloseHandle(h);
  return name;
}

std::string windowTitle(HWND hwnd) {
  int len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return {};
  std::wstring title((size_t)len + 1, L'\0');
  int got = GetWindowTextW(hwnd, title.data(), len + 1);
  return wideToUtf8(title.c_str(), got);
}

struct FindMain {
  DWORD pid;
  HWND hwnd;
};
BOOL CALLBACK findMainProc(HWND hwnd, LPARAM lp) {
  auto* fm = reinterpret_cast<FindMain*>(lp);
  DWORD wpid = 0;
  GetWindowThreadProcessId(hwnd, &wpid);
  if (wpid == fm->pid && IsWindowVisible(hwnd) && GetWindow(hwnd, GW_OWNER) == nullptr &&
      GetWindowTextLengthW(hwnd) > 0) {
    fm->hwnd = hwnd;
    return FALSE;  // stop
  }
  return TRUE;
}
HWND findMainWindow(DWORD pid) {
  FindMain fm{pid, nullptr};
  EnumWindows(findMainProc, reinterpret_cast<LPARAM>(&fm));
  return fm.hwnd;
}

std::string normalizeRole(CONTROLTYPEID ct) {
  switch (ct) {
    case UIA_ButtonControlTypeId: return "AXButton";
    case UIA_EditControlTypeId: return "AXTextField";
    case UIA_DocumentControlTypeId: return "AXTextArea";
    case UIA_TextControlTypeId: return "AXStaticText";
    case UIA_HyperlinkControlTypeId: return "AXLink";
    case UIA_CheckBoxControlTypeId: return "AXCheckBox";
    case UIA_RadioButtonControlTypeId: return "AXRadioButton";
    case UIA_ComboBoxControlTypeId: return "AXComboBox";
    case UIA_ListControlTypeId: return "AXList";
    case UIA_ListItemControlTypeId: return "AXCell";
    case UIA_MenuControlTypeId: return "AXMenu";
    case UIA_MenuItemControlTypeId: return "AXMenuItem";
    case UIA_MenuBarControlTypeId: return "AXMenuBar";
    case UIA_TabControlTypeId: return "AXTabGroup";
    case UIA_TabItemControlTypeId: return "AXRadioButton";
    case UIA_WindowControlTypeId: return "AXWindow";
    case UIA_ImageControlTypeId: return "AXImage";
    case UIA_TreeControlTypeId: return "AXOutline";
    case UIA_TreeItemControlTypeId: return "AXRow";
    case UIA_GroupControlTypeId: return "AXGroup";
    case UIA_PaneControlTypeId: return "AXGroup";
    case UIA_ToolBarControlTypeId: return "AXToolbar";
    case UIA_SliderControlTypeId: return "AXSlider";
    case UIA_ProgressBarControlTypeId: return "AXProgressIndicator";
    case UIA_ScrollBarControlTypeId: return "AXScrollBar";
    case UIA_TableControlTypeId: return "AXTable";
    case UIA_SpinnerControlTypeId: return "AXIncrementor";
    default: return "AXGroup";
  }
}

ComPtr<IUIAutomation> makeAutomation() {
  ComPtr<IUIAutomation> a;
  checkHr(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&a)),
          "CoCreateInstance(CUIAutomation) failed");
  return a;
}

}  // namespace

json snapshot(int pid) {
  ElementRegistry::instance().reset();

  ComPtr<IUIAutomation> automation = makeAutomation();
  HWND hwnd = pid > 0 ? findMainWindow((DWORD)pid) : GetForegroundWindow();
  if (!hwnd) throw std::runtime_error("no target window");

  ComPtr<IUIAutomationElement> root;
  checkHr(automation->ElementFromHandle(hwnd, &root), "ElementFromHandle failed");

  // Batch the property reads: UIA per-property calls are cross-process and slow.
  ComPtr<IUIAutomationCacheRequest> cache;
  checkHr(automation->CreateCacheRequest(&cache), "CreateCacheRequest failed");
  cache->AddProperty(UIA_ControlTypePropertyId);
  cache->AddProperty(UIA_NamePropertyId);
  cache->AddProperty(UIA_BoundingRectanglePropertyId);
  cache->AddProperty(UIA_HasKeyboardFocusPropertyId);
  cache->AddProperty(UIA_ProcessIdPropertyId);
  cache->AddProperty(UIA_ValueValuePropertyId);

  ComPtr<IUIAutomationCondition> cond;
  checkHr(automation->CreateTrueCondition(&cond), "CreateTrueCondition failed");

  ComPtr<IUIAutomationElementArray> arr;
  checkHr(root->FindAllBuildCache(TreeScope_Subtree, cond.Get(), cache.Get(), &arr),
          "FindAllBuildCache failed");

  DWORD targetPid = 0;
  GetWindowThreadProcessId(hwnd, &targetPid);

  int len = 0;
  if (arr) arr->get_Length(&len);
  const int kCap = 2500;
  json elements = json::array();

  for (int i = 0; i < len && (int)elements.size() < kCap; ++i) {
    ComPtr<IUIAutomationElement> el;
    if (FAILED(arr->GetElement(i, &el)) || !el) continue;

    ReadableElement re;
    CONTROLTYPEID ct = 0;
    el->get_CachedControlType(&ct);
    re.role = normalizeRole(ct);

    BSTR nm = nullptr;
    el->get_CachedName(&nm);
    re.name = bstrToUtf8(nm);
    if (nm) SysFreeString(nm);

    RECT r{};
    if (SUCCEEDED(el->get_CachedBoundingRectangle(&r))) {
      re.x = r.left;
      re.y = r.top;
      re.w = r.right - r.left;
      re.h = r.bottom - r.top;
      re.hasFrame = (re.w > 0 && re.h > 0);
    }

    BOOL focused = FALSE;
    el->get_CachedHasKeyboardFocus(&focused);
    re.focused = !!focused;

    int epid = 0;
    el->get_CachedProcessId(&epid);
    re.pid = epid;

    VARIANT v;
    VariantInit(&v);
    if (SUCCEEDED(el->GetCachedPropertyValue(UIA_ValueValuePropertyId, &v)) && v.vt == VT_BSTR) {
      re.value = bstrToUtf8(v.bstrVal);
    }
    VariantClear(&v);

    // Skip anonymous containers with nothing useful (no frame, no name, no value).
    if (!re.hasFrame && re.name.empty() && re.value.empty()) continue;

    re.index = ElementRegistry::instance().add(el);
    elements.push_back(toJson(re));
  }

  return json{{"pid", (int)targetPid}, {"count", (int)elements.size()}, {"elements", std::move(elements)}};
}

json frontmostWindow() {
  HWND hwnd = GetForegroundWindow();
  if (!hwnd) return json{{"pid", 0}};
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  std::string exe = exeNameForPid(pid);
  RECT r{};
  GetWindowRect(hwnd, &r);
  return json{{"title", windowTitle(hwnd)},
              {"pid", (int)pid},
              {"app", exe},
              {"bundleId", exe},
              {"frame", json{{"x", r.left}, {"y", r.top}, {"width", r.right - r.left}, {"height", r.bottom - r.top}}}};
}

namespace {
struct AppWin {
  DWORD pid;
  HWND hwnd;
};
BOOL CALLBACK enumAppsProc(HWND hwnd, LPARAM lp) {
  auto* out = reinterpret_cast<std::vector<AppWin>*>(lp);
  if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  if (GetWindowTextLengthW(hwnd) == 0) return TRUE;
  if (GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) return TRUE;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  out->push_back({pid, hwnd});
  return TRUE;
}
}  // namespace

json listApps() {
  std::vector<AppWin> wins;
  EnumWindows(enumAppsProc, reinterpret_cast<LPARAM>(&wins));
  DWORD fg = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &fg);

  std::set<DWORD> seen;
  json arr = json::array();
  for (const auto& w : wins) {
    if (seen.count(w.pid)) continue;
    seen.insert(w.pid);
    std::string exe = exeNameForPid(w.pid);
    arr.push_back(json{{"pid", (int)w.pid}, {"name", exe}, {"bundleId", exe}, {"frontmost", w.pid == fg}});
  }
  return arr;
}

bool elementCenter(int index, int& x, int& y) {
  auto el = ElementRegistry::instance().get(index);
  if (!el) return false;
  RECT r{};
  if (FAILED(el->get_CurrentBoundingRectangle(&r))) return false;
  if (r.right <= r.left || r.bottom <= r.top) return false;
  x = (r.left + r.right) / 2;
  y = (r.top + r.bottom) / 2;
  return true;
}

}  // namespace uia
}  // namespace nicosoft
