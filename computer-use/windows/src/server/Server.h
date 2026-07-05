#pragma once
//
// The helper's core: resolves the pipe name, wires the RPC method registry to
// the named-pipe transport, and registers handlers. Counterpart of the macOS
// helper's Server.swift. Capability handlers (screenshot / ui_tree /
// perform_action / …) are added in later batches; P0 registers only `ping`.
#include "ipc/NamedPipeListener.h"
#include "ipc/RpcServer.h"

#include <memory>
#include <string>

namespace nicosoft {

class Server {
 public:
  Server();     // resolves the pipe name (NSAI_CUA_PIPE override) and wires handlers
  ~Server();
  void run();   // prints the ready banner, then blocks on the pipe accept loop

 private:
  std::wstring pipeName_;
  RpcServer rpc_;
  std::unique_ptr<NamedPipeListener> listener_;
};

}  // namespace nicosoft
