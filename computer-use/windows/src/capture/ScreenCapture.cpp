#include "capture/ScreenCapture.h"

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <cstring>

// C++/WinRT projections (header-only, ship with the Windows SDK).
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>  // IClosable::Close projection (session/framePool.Close)
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
// Interop factories that bridge WGC/WinRT with classic Win32/D3D handles.
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

namespace nicosoft {
namespace {

namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgdx = winrt::Windows::Graphics::DirectX;
namespace wg3d = winrt::Windows::Graphics::DirectX::Direct3D11;
using winrt::com_ptr;
using winrt::check_hresult;

// Pull the underlying ID3D11Texture2D out of a WGC frame's IDirect3DSurface.
com_ptr<ID3D11Texture2D> surfaceTexture(const wg3d::IDirect3DSurface& surface) {
  auto access =
      surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
  com_ptr<ID3D11Texture2D> tex;
  check_hresult(access->GetInterface(winrt::guid_of<ID3D11Texture2D>(), tex.put_void()));
  return tex;
}

}  // namespace

bool capturePrimaryMonitor(CapturedFrame& out) {
  try {
    // 1) A D3D11 device (BGRA support required for WGC's B8G8R8A8 frames).
    com_ptr<ID3D11Device> d3dDevice;
    com_ptr<ID3D11DeviceContext> context;
    check_hresult(D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        nullptr, 0, D3D11_SDK_VERSION, d3dDevice.put(), nullptr, context.put()));

    // 2) Wrap it as a WinRT IDirect3DDevice for WGC.
    com_ptr<IDXGIDevice> dxgiDevice = d3dDevice.as<IDXGIDevice>();
    com_ptr<::IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
    wg3d::IDirect3DDevice device = inspectable.as<wg3d::IDirect3DDevice>();

    // 3) A capture item for the primary monitor.
    HMONITOR hmon = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
    auto interop =
        winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    wgc::GraphicsCaptureItem item{nullptr};
    check_hresult(interop->CreateForMonitor(
        hmon, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item)));

    // 4) Free-threaded frame pool → no DispatcherQueue/message loop needed for a
    //    one-shot grab (we poll TryGetNextFrame instead of handling FrameArrived).
    auto size = item.Size();
    auto framePool = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
        device, wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    auto session = framePool.CreateCaptureSession(item);
    session.StartCapture();

    // 5) Wait for the first frame (StartCapture warms up asynchronously).
    wgc::Direct3D11CaptureFrame frame{nullptr};
    for (int i = 0; i < 400 && !frame; ++i) {
      frame = framePool.TryGetNextFrame();
      if (!frame) Sleep(5);
    }
    if (!frame) {
      session.Close();
      framePool.Close();
      return false;
    }

    // 6) Copy the GPU texture into a CPU-readable staging texture and map it.
    com_ptr<ID3D11Texture2D> tex = surfaceTexture(frame.Surface());
    D3D11_TEXTURE2D_DESC desc{};
    tex->GetDesc(&desc);

    D3D11_TEXTURE2D_DESC staged = desc;
    staged.Usage = D3D11_USAGE_STAGING;
    staged.BindFlags = 0;
    staged.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    staged.MiscFlags = 0;
    com_ptr<ID3D11Texture2D> staging;
    check_hresult(d3dDevice->CreateTexture2D(&staged, nullptr, staging.put()));
    context->CopyResource(staging.get(), tex.get());

    D3D11_MAPPED_SUBRESOURCE mapped{};
    check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));

    out.width = static_cast<int>(desc.Width);
    out.height = static_cast<int>(desc.Height);
    out.rowPitch = static_cast<int>(mapped.RowPitch);
    out.bgra.resize(static_cast<size_t>(mapped.RowPitch) * desc.Height);
    std::memcpy(out.bgra.data(), mapped.pData, out.bgra.size());

    context->Unmap(staging.get(), 0);
    session.Close();
    framePool.Close();
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace nicosoft
