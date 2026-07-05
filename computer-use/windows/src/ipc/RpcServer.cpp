#include "ipc/RpcServer.h"

namespace nicosoft {

void RpcServer::on(const std::string& method, Handler handler) {
  handlers_[method] = std::move(handler);
}

std::string RpcServer::handleLine(const std::string& line) {
  json id = nullptr;
  try {
    RpcRequest req = parseRequest(line);
    id = req.id;
    auto it = handlers_.find(req.method);
    if (it == handlers_.end()) {
      return makeError(id, -32601, "method not found: " + req.method).dump();
    }
    json result = it->second(req.params);
    return makeResult(id, std::move(result)).dump();
  } catch (const json::exception& e) {
    return makeError(id, -32700, std::string("parse error: ") + e.what()).dump();
  } catch (const std::exception& e) {
    return makeError(id, -32000, e.what()).dump();
  } catch (...) {
    // Non-standard throwables (e.g. winrt::hresult_error, which does NOT derive
    // from std::exception) or SEH translated by _set_se_translator land here.
    return makeError(id, -32001, "unhandled exception in handler").dump();
  }
}

}  // namespace nicosoft
