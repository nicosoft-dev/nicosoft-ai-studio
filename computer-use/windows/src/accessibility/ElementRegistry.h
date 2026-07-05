#pragma once
//
// Maps a flat ui_tree index → a live UIA element handle, so perform_action can
// target an element by index (the macOS helper's ElementRegistry equivalent).
// Rebuilt on every snapshot; guarded by a mutex since connection threads run
// concurrently.
//
// Uses WRL::ComPtr (classic COM) rather than winrt::com_ptr: the classic UIA
// headers (uiautomation.h) and C++/WinRT's winrt/base.h clash when included in
// the same translation unit, so the accessibility module stays winrt-free.
#include <windows.h>
#include <ole2.h>  // OLE interfaces UIAutomationCore.h needs (stripped by WIN32_LEAN_AND_MEAN)
#include <uiautomation.h>
#include <wrl/client.h>

#include <mutex>
#include <vector>

namespace nicosoft {

class ElementRegistry {
 public:
  static ElementRegistry& instance();

  void reset();
  int add(Microsoft::WRL::ComPtr<IUIAutomationElement> element);  // returns its index
  Microsoft::WRL::ComPtr<IUIAutomationElement> get(int index);

 private:
  std::mutex mutex_;
  std::vector<Microsoft::WRL::ComPtr<IUIAutomationElement>> elements_;
};

}  // namespace nicosoft
