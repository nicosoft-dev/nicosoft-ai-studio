# NicoSoft AI Studio — Browser Automation Extension

A Manifest V3 **Chrome** extension that lets Studio's AI experts drive the
user's *real* Chrome: open tabs, navigate, and — after the user logs in
themselves — collect page data and operate pages (click, type, submit).

> **Status: scaffold** — directory layout only; implementation pending.
> **Chrome only for now.** Other browsers (Edge / Brave / Arc) are not
> supported yet.

## How it fits together

```
Studio agent  ─►  Studio main (BrowserBridge)  ─►  Native Messaging host shim
                                                          │ stdio
                                                          ▼
                                              this extension (MV3)
                                                 │ chrome.tabs / scripting
                                                 │ captureVisibleTab
                                                 │ chrome.debugger (CDP)
                                                 ▼
                                          user's Chrome tabs (logged in)
```

- **Transport — Native Messaging.** Chrome only lets the whitelisted extension
  ID connect, with no network port exposed. A small host shim forwards
  stdio ⇄ the always-running Studio app.
- **Capabilities.** `chrome.tabs` (tabs / navigation), `chrome.scripting`
  (DOM read + actions), `chrome.tabs.captureVisibleTab` (screenshots), and
  `chrome.debugger` → CDP `Input` (coordinate click / type), `Accessibility`
  (a11y tree), `Network` (response capture).

## Layout

| Path | Purpose |
|---|---|
| `background/` | MV3 service worker: message routing, CDP session management, keep-alive / reconnect |
| `content/` | content scripts: DOM collection, interactive-element indexing |
| `options/` | pairing UI (one-time token) + connection status |
| `icons/` | extension icons |
| `manifest.json` | MV3 manifest (added during implementation) |
| `dist/` | build output (gitignored) |

## Develop

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this folder.
2. In Studio, install the browser connection (registers the Native Messaging
   host manifest) and paste the pairing token into the extension's options page.

## Security

- A pairing token plus an extension-ID allowlist gate every connection.
- The agent **never** enters passwords, 2FA, or payment details — it stops and
  asks the user to log in.
- Page content is treated as data, not instructions (prompt-injection guard);
  write actions require approval in Studio.
