#include "ipc/NamedPipeListener.h"

#include <windows.h>
#include <objbase.h>  // CoInitializeEx / CoUninitialize (excluded by WIN32_LEAN_AND_MEAN)
#include <eh.h>       // _set_se_translator

#include <cstdio>
#include <stdexcept>
#include <string>
#include <thread>

namespace nicosoft {
namespace {

// Turn a structured (SEH) exception — access violation, etc. — into a C++
// exception so the catch(...) guards below can contain it instead of the
// process crashing. Requires /EHa (set in CMakeLists.txt).
void seTranslator(unsigned int code, EXCEPTION_POINTERS*) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "structured exception 0x%08X", code);
  throw std::runtime_error(buf);
}

}  // namespace

NamedPipeListener::NamedPipeListener(std::wstring pipeName, LineHandler onLine)
    : pipeName_(std::move(pipeName)), onLine_(std::move(onLine)) {}

void NamedPipeListener::run() {
  _set_se_translator(seTranslator);
  while (running_.load(std::memory_order_relaxed)) {
    // Guard each accept iteration: a failure here must never kill the helper.
    try {
      HANDLE pipe = CreateNamedPipeW(
          pipeName_.c_str(), PIPE_ACCESS_DUPLEX,
          PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES,
          /*outBuf*/ 64 * 1024, /*inBuf*/ 64 * 1024, /*defaultTimeout*/ 0,
          /*security*/ nullptr);
      if (pipe == INVALID_HANDLE_VALUE) {
        Sleep(100);
        continue;
      }

      BOOL connected = ConnectNamedPipe(pipe, nullptr)
                           ? TRUE
                           : (GetLastError() == ERROR_PIPE_CONNECTED);
      if (!running_.load(std::memory_order_relaxed)) {
        CloseHandle(pipe);
        break;
      }
      if (!connected) {
        CloseHandle(pipe);
        continue;
      }

      std::thread(&NamedPipeListener::serveClient, this, pipe).detach();
    } catch (...) {
      Sleep(50);
    }
  }
}

void NamedPipeListener::stop() { running_.store(false, std::memory_order_relaxed); }

void NamedPipeListener::serveClient(void* pipeHandle) {
  // Capture (WGC/WIC) and other COM/WinRT work runs on this thread, so join the
  // process multithreaded apartment for the connection's lifetime.
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  _set_se_translator(seTranslator);
  HANDLE pipe = static_cast<HANDLE>(pipeHandle);

  // A crash in one connection (bad handler, WGC/UIA fault, …) must never take
  // down the whole helper — contain it and just drop this connection.
  try {
    std::string buffer;
    char chunk[8192];
    while (running_.load(std::memory_order_relaxed)) {
      DWORD read = 0;
      BOOL ok = ReadFile(pipe, chunk, static_cast<DWORD>(sizeof(chunk)), &read, nullptr);
      if (!ok || read == 0) break;  // client closed or error
      buffer.append(chunk, read);

      // Drain every complete, newline-terminated line.
      size_t nl;
      while ((nl = buffer.find('\n')) != std::string::npos) {
        std::string line = buffer.substr(0, nl);
        buffer.erase(0, nl + 1);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;

        std::string response = onLine_(line);
        response.push_back('\n');
        DWORD written = 0;
        const char* p = response.data();
        DWORD remaining = static_cast<DWORD>(response.size());
        while (remaining > 0) {
          if (!WriteFile(pipe, p, remaining, &written, nullptr) || written == 0) {
            remaining = 0;  // peer gone; drop
            break;
          }
          p += written;
          remaining -= written;
        }
      }
    }
  } catch (...) {
    // swallowed — the accept loop keeps serving other connections
  }

  FlushFileBuffers(pipe);
  DisconnectNamedPipe(pipe);
  CloseHandle(pipe);
  CoUninitialize();
}

}  // namespace nicosoft
