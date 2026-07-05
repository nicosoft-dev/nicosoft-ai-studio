#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace nicosoft {

// Standard base64 (RFC 4648), used to ship PNG bytes over JSON-RPC.
inline std::string base64Encode(const uint8_t* data, size_t len) {
  static const char kTable[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  size_t i = 0;
  for (; i + 2 < len; i += 3) {
    uint32_t n = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8) | data[i + 2];
    out.push_back(kTable[(n >> 18) & 63]);
    out.push_back(kTable[(n >> 12) & 63]);
    out.push_back(kTable[(n >> 6) & 63]);
    out.push_back(kTable[n & 63]);
  }
  if (i < len) {
    bool two = (i + 1 < len);
    uint32_t n = uint32_t(data[i]) << 16;
    if (two) n |= uint32_t(data[i + 1]) << 8;
    out.push_back(kTable[(n >> 18) & 63]);
    out.push_back(kTable[(n >> 12) & 63]);
    out.push_back(two ? kTable[(n >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}

inline std::string base64Encode(const std::vector<uint8_t>& v) {
  return base64Encode(v.data(), v.size());
}

}  // namespace nicosoft
