#pragma once
//
// Method registry + dispatch. Equivalent to the routing core of the macOS
// helper's Server.swift: map a method name to a handler and turn a raw request
// line into a serialized response line.
#include "ipc/JsonRpc.h"

#include <functional>
#include <string>
#include <unordered_map>

namespace nicosoft {

class RpcServer {
 public:
  // A handler receives the request `params` and returns the `result` payload.
  // Throw std::exception to produce a JSON-RPC error response.
  using Handler = std::function<json(const json& params)>;

  void on(const std::string& method, Handler handler);

  // Parse → dispatch → serialize. Never throws; failures become error responses.
  // Returns the response JSON as a string (without a trailing newline).
  std::string handleLine(const std::string& line);

 private:
  std::unordered_map<std::string, Handler> handlers_;
};

}  // namespace nicosoft
