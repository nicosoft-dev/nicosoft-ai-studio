#pragma once
//
// Newline-delimited JSON-RPC 2.0 message helpers. Mirrors the wire contract of
// the macOS helper's IPC/JSONRPC.swift so the Studio-side socket client is the
// same on both platforms.
#include <nlohmann/json.hpp>
#include <string>

namespace nicosoft {
using json = nlohmann::json;

struct RpcRequest {
  json id;             // request id echoed back; null if absent
  std::string method;  // method name
  json params;         // params object, or null
};

// Parse one request line. Throws nlohmann::json::exception on malformed input.
inline RpcRequest parseRequest(const std::string& line) {
  json j = json::parse(line);
  RpcRequest req;
  req.id = j.contains("id") ? j.at("id") : json(nullptr);
  req.method = j.value("method", std::string{});
  // Normalize a missing/null params to an empty object so handlers can always
  // call params.value("key", default) without a type error.
  req.params = (j.contains("params") && !j.at("params").is_null()) ? j.at("params") : json::object();
  return req;
}

inline json makeResult(const json& id, json result) {
  return json{{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(result)}};
}

inline json makeError(const json& id, int code, const std::string& message) {
  return json{{"jsonrpc", "2.0"},
              {"id", id},
              {"error", {{"code", code}, {"message", message}}}};
}
}  // namespace nicosoft
