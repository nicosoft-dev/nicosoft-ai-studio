# Extensions

Everything you plug into the team lives under sidebar → Extensions, in four tabs: MCP, Skills, Plugins, Tools.

Scoping applies across all of them: extensions run inside an expert's agent loop — every built-in expert has one, Danny included — and the **Scope** (All experts / specific ones) only controls *which* experts are offered the capability.

## MCP servers

External tools & data sources your experts can call (Model Context Protocol).

1. "+ Add MCP server".
2. Either fill the fields — Name; Transport **stdio (local)** (Command such as `npx`, Arguments space-separated, Environment as `KEY=value` per line) or **HTTP** (URL, Headers) — or use "Paste config JSON" with a standard `mcpServers` snippet to fill them automatically.
3. Save, then **Test connection**. A healthy server shows Connected and "{n} tools".

Secrets entered under Environment/Headers are kept in the OS keychain. Each row has an enable/disable toggle, a Scope, and an Edit / Test connection / Remove menu. Once connected, the server's tools are available to in-scope experts automatically — calls show up as tool cards in chat.

## Skills

Packaged instructions experts load on demand — see the Skills guide for details, including distilled-skill drafts.

## Plugins

Bundles that install a whole set at once — skills, MCP servers and roles.

- "+ Install plugin" from a folder containing `plugin.json`. The row lists what came with it (chips per skill / MCP / role) and a summary like "2 skills · 1 MCP · 1 role".
- Bundled items are marked "via {plugin}" and are managed by the plugin; Uninstall removes the set.

## Tools (built-ins)

- **Generate Image** (`ns_generate_image`) — posters, illustrations, avatars and thumbnails; pick its default model; scoped to the Designer by default. The `ns_` prefix marks reusable built-ins any agent can be granted.
- **Playwright** — a read-only status card for Tier 2 browser automation (package + Chromium browser state). Your engineering expert installs it on request; the Tier 1 preview tools work without it.
- **Computer use** (`ns_computer_use`, macOS and Windows) — lets any expert see and control your computer: screenshot the screen (or stream it live to watch something change), read on-screen elements, click, type (any language), scroll, and drag across native apps, not just the browser. A global switch turns it on for every expert. It runs through a small native helper ("NicoSoft Computer Use"). On macOS it needs two permissions — Accessibility and Screen Recording — shown on the card (installed/running plus each permission's state) with an "Open settings" shortcut to grant them; Windows needs no per-app permission. While an expert is in control a banner shows on screen; press Esc to stop at any time.
