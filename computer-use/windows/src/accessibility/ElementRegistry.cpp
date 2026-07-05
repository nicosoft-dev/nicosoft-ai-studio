#include "accessibility/ElementRegistry.h"

namespace nicosoft {

using Microsoft::WRL::ComPtr;

ElementRegistry& ElementRegistry::instance() {
  static ElementRegistry registry;
  return registry;
}

void ElementRegistry::reset() {
  std::lock_guard<std::mutex> lock(mutex_);
  elements_.clear();
}

int ElementRegistry::add(ComPtr<IUIAutomationElement> element) {
  std::lock_guard<std::mutex> lock(mutex_);
  elements_.push_back(std::move(element));
  return static_cast<int>(elements_.size()) - 1;
}

ComPtr<IUIAutomationElement> ElementRegistry::get(int index) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (index < 0 || index >= static_cast<int>(elements_.size())) return nullptr;
  return elements_[index];
}

}  // namespace nicosoft
