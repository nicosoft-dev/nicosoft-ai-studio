#pragma once
//
// Encode a raw BGRA frame to a PNG, base64-encoded for JSON-RPC transport.
// Full resolution — matches the macOS helper, which returns full-res pixels and
// lets the Studio side downscale/map coordinates.
#include <cstdint>
#include <string>

namespace nicosoft {

// bgra: rowPitch bytes/row, `height` rows. Returns base64(PNG). Throws
// winrt::hresult_error on WIC failure. Requires a COM-initialized thread.
std::string encodePngBase64(const uint8_t* bgra, int width, int height, int rowPitch);

}  // namespace nicosoft
