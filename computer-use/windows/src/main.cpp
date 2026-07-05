// NsComputerUseHelper (Windows) entry point.
//
// P0: a console process that serves newline-delimited JSON-RPC over a named
// pipe and answers `ping`. No desktop interaction yet, so it can be exercised
// from any session (incl. a non-interactive SSH shell). Later batches add the
// capability handlers and move to a windowed, message-pumped process.
#include "server/Server.h"

int main() {
  nicosoft::Server server;
  server.run();  // blocks
  return 0;
}
