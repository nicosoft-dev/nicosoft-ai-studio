#include "capture/ImageEncoder.h"

#include <windows.h>
#include <wincodec.h>
#include <winrt/base.h>

#include <vector>

#include "support/Base64.h"

namespace nicosoft {

using winrt::com_ptr;
using winrt::check_hresult;

std::string encodePngBase64(const uint8_t* bgra, int width, int height, int rowPitch) {
  com_ptr<IWICImagingFactory> factory;
  check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                 __uuidof(IWICImagingFactory), factory.put_void()));

  // Treat the source as 32bpp BGR (X channel ignored): WGC desktop frames carry
  // alpha 0, so honoring alpha would yield a fully transparent PNG.
  com_ptr<IWICBitmap> bitmap;
  check_hresult(factory->CreateBitmapFromMemory(
      static_cast<UINT>(width), static_cast<UINT>(height), GUID_WICPixelFormat32bppBGR,
      static_cast<UINT>(rowPitch), static_cast<UINT>(rowPitch) * height,
      const_cast<BYTE*>(bgra), bitmap.put()));

  com_ptr<IStream> stream;
  check_hresult(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()));

  com_ptr<IWICBitmapEncoder> encoder;
  check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
  check_hresult(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache));

  com_ptr<IWICBitmapFrameEncode> frame;
  check_hresult(encoder->CreateNewFrame(frame.put(), nullptr));
  check_hresult(frame->Initialize(nullptr));
  check_hresult(frame->SetSize(static_cast<UINT>(width), static_cast<UINT>(height)));
  WICPixelFormatGUID fmt = GUID_WICPixelFormat24bppBGR;  // opaque output
  check_hresult(frame->SetPixelFormat(&fmt));
  check_hresult(frame->WriteSource(bitmap.get(), nullptr));
  check_hresult(frame->Commit());
  check_hresult(encoder->Commit());

  STATSTG stat{};
  check_hresult(stream->Stat(&stat, STATFLAG_NONAME));
  ULONG size = static_cast<ULONG>(stat.cbSize.QuadPart);
  std::vector<uint8_t> buf(size);
  LARGE_INTEGER zero{};
  check_hresult(stream->Seek(zero, STREAM_SEEK_SET, nullptr));
  ULONG read = 0;
  check_hresult(stream->Read(buf.data(), size, &read));

  return base64Encode(buf.data(), read);
}

}  // namespace nicosoft
