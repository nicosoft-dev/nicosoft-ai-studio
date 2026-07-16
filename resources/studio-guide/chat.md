# Chat & Conversations

The main surface: talk to one expert (solo) or to Danny (the coordinator, who routes). Replies stream live with reasoning, tool activity and results.

## Starting and managing conversations

- Sidebar → "New Conversation" → pick a role.
- History groups conversations under Pinned, Today, Yesterday, Earlier and a collapsible Archived section. Each row's ⋯ menu: Pin/Unpin, Rename, Archive/Unarchive, Delete.
- Topbar → Actions: Rename, Export Markdown, Export JSON, Delete. Deleting is permanent.

## The composer

- Enter sends, Shift+Enter inserts a newline. "Stop" cancels the current turn.
- **Ghost suggestion**: after a reply settles, a faint suggestion of what you might type next can appear in the empty input. **Tab** fills it in for editing; **Escape** dismisses it; typing anything hides it (clearing the draft brings it back); Enter ignores it — an empty composer never sends. It reuses the conversation's own model over the prompt cache, so it costs next to nothing; it stays silent early in a conversation or when the cache is cold. Toggle it in Settings → General → "Prompt suggestions".
- **Images**: paste, drag-and-drop, or the "Attach image" button (images only — other file types go through the working folder instead).
- **Folder**: the path bar picks a working directory, enabling Files / Diff / Terminal / Preview for this conversation (see Workspace).
- **Pickers** under the input: model, thinking depth (when the model supports it), permission Mode (Ask / Plan / Auto), and — for Georgia — an image model picker.
- **Context ring**: a small ring at the right of the pickers fills as the context window does. Hover it for the exact reading (e.g. `45.2K / 200K (23%)`). It is accent-coloured until 75%, amber from 75%, and red from 90% — use `/compact` once it turns.
- **Context window panel**: click the ring to see what the prompt is made of — System prompt, Auto-memory, System tools, Messages and Free space, as a stacked bar plus a legend with tokens and percentages. The total is the size the API itself charged for your last turn, so it is the real one; it is still labelled "Estimated usage by category" because splitting that total into categories means measuring each part on its own and letting the tool kit fall out as whatever is left over, which carries a little error even when the total does not. The panel appears once a turn has run (agent roles), and is hidden briefly after `/compact` until the next turn re-measures.
- **When the prompt exceeds the window** (a mis-declared custom endpoint, a stale catalog entry, or a small-window model under a tool-heavy role), the panel says so instead of pretending: the header total turns red, an **Over window** row shows the deficit (e.g. `+512 · +1.2%`), and the bar becomes the prompt's own composition. If the System prompt, tools and memory *alone* exceed the compaction trigger, a note explains that compacting messages cannot free space — automatic compaction stands down in that state (it would burn two model calls per turn for nothing) — and the fix is a larger-window model or a leaner role. Overflow recovery still folds as a last resort.
- **Automatic compaction** folds older history into the summary at 90% of the window after a turn completes. For agent roles it can also fold once *before* a run starts, when the conversation has grown past the agent's working threshold — the first reply then takes a little longer while the fold runs, and the context ring drops to the new, smaller size. Either way the fold is durable: it happens once, not once per run.

## Slash commands

Type `/` in the composer:

| Command | What it does |
|---|---|
| `/new`, `/clear` | Start a new conversation |
| `/compact` | Summarize older history to free context — a visible receipt shows what was folded, and it can be stopped |
| `/plan` | Switch to Plan mode (read-only investigation) |
| `/default` | Back to the default acting mode |
| `/mode <Ask\|Plan\|Auto>` | Set the permission mode |
| `/memory` | Open Memory Live (the 3D memory cloud) |
| `/workflow` | On its own, shows usage; `/workflow list` lists every workflow; `/workflow <name> [key=value …]` launches an enabled one (see Workflows) |
| `/schedule` | On its own, shows usage; `/schedule list` lists every scheduled task; `/schedule <id\|name>` runs one right now (even a disabled one) |

The palette shows just these two roots for workflows and tasks — not a row per item. Type `/workflow list` or `/schedule list` to see everything; the list appears in a dismissable block above the composer (it isn't sent to the model).

## Reading a reply

- Each expert's contribution is a segment with its avatar and name chip. Coordinator turns start with a **dispatch badge** showing the routing chain; **Synthesis** and **Verifier** tags mark the merge and final-review parts.
- Consecutive tool calls fold into a one-line activity summary ("Reading …, running a command") — click to expand the individual tool cards. Some tools render inline cards (widgets, images, plans).
- While streaming, a live readout at the bottom shows elapsed time, tokens in/out and the current activity; "Stop" is available the whole time.

## Approvals and questions

- In Ask mode, actions pause with "wants to run" → **Allow** / **Deny**.
- Plan mode ends with "Plan ready for review" → **Approve & run** or **Revise**.
- An expert may ask you a question with clickable options — pick one or type another answer.
