#pragma once
//
// Named-pipe server: the Windows transport for the JSON-RPC protocol (the
// counterpart of macOS's UnixSocketListener). Accepts multiple concurrent
// clients (one instance + one thread per client) and exchanges newline-
// delimited messages. Blocking I/O; run() blocks until stop() is called.
#include <atomic>
#include <functional>
#include <string>

namespace nicosoft {

class NamedPipeListener {
 public:
  // Maps one request line to one response line (no trailing newline needed).
  using LineHandler = std::function<std::string(const std::string&)>;

  NamedPipeListener(std::wstring pipeName, LineHandler onLine);

  void run();   // blocks: accept loop, spawns a thread per connected client
  void stop();  // request shutdown of the accept loop

 private:
  void serveClient(void* pipeHandle);

  std::wstring pipeName_;
  LineHandler onLine_;
  std::atomic<bool> running_{true};
};

}  // namespace nicosoft
