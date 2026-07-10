# Workflows

A workflow is a saved multi-expert procedure: a small script that pins which experts run, in what order (phases, sequential or parallel steps) and with which typed parameters. Unlike free-form routing, a workflow runs the same way every time. Find them under sidebar → Workflows.

## Create and edit

- "New workflow" opens the editor; "Import" loads an exported workflow file (row menu → Export writes one). The row menu also edits, duplicates and deletes a workflow — deleting asks for confirmation (the script and run history go with it).
- The editor shows a **form** (Name, Description, Params) and the **script** side by side — they stay in sync in both directions as you type.
- **Params** (⇄ `meta.params`) define the run form: name, type (string / number / boolean / folder), optional default.
- The script body reads the picked values through the **`args`** global — a param named `url` is `args.url` (there is no `params` variable at run time). `args.runAt` always carries the fire time as an ISO string.
- Lint runs continuously. **Test run** (enabled once lint passes) executes without saving; **Save** persists.
- New, imported and distilled workflows start as **drafts** — the row reads "draft — never run" with a **Review** button. Flip the row switch to enable it. Only enabled workflows can run and appear as `/workflow` commands.

## Run and watch

- List row → **Run** → fill the parameter form → Run. While running, the button reads **View**.
- The **run panel** shows one card per step: expert, phase, status, live text, tool cards, token counts and duration, with a rail of the planned structure ending in `return`.
- Row menu → **Runs** lists past runs; a settled run replays in full (steps, text, tool cards).

## Drafting with an expert

- Ask any expert in plain language to build a workflow ("draft a weekly competitor-analysis workflow: fetch data, two analysts in parallel, then a summary") — the expert drafts the script and a **draft card** appears in the conversation: name, description, params and a read-only **flow diagram** derived from the script itself, so what you see is exactly what would be created.
- **Nothing is created until you confirm.** Click **Create** on the card to save it — it lands enabled and ready to run, credited to you with the drafting expert recorded as its origin. Ignoring the card simply discards the draft.
- Not happy? Just keep talking — the expert submits a revision, the old card grays out ("replaced by a newer draft") and a new card takes its place. After you've created one, further revisions confirm as **Update** on the same workflow.
- **Open in editor** copies the drafted script into a fresh editor for hand-tuning — nothing is saved until you press Save there.
- The Workflows page's **Draft with AI** button starts this flow directly: it opens a new conversation with the request pre-typed.

## Launch from chat

- `/workflow <name> key=value …` — parameters use `key=value`; quote values containing spaces (`key="two words"`). Unknown or malformed parameters are rejected with a message and nothing runs.
- In an **expert conversation**, the expert first reviews the workflow (the script plus a mechanical verdict) and explicitly decides to launch — you see that review as a normal turn with a launch card.
- In a **Danny conversation**, it launches directly with a launch card. Either way a toast confirms: "Workflow {name} started — watch it in Workflows".
- Chat launches are **asynchronous by default**: the conversation stays free, and when the run settles (result or error) the launching expert wakes up and reports the outcome as a new turn. If the conversation is mid-turn, the wake-up waits until the turn ends. Experts can also poll progress with the `workflow_status` tool.
- You can simply ask an expert in plain language to run a workflow — it uses the same review-then-launch path.

## Where runs show up

- Tasks panel (⌘J) → **Workflows** tab: runs launched from this conversation, with a click-through to the run panel.
- Tasks panel → **History**: settled runs persist with full replay.
- The Workflows view lists every workflow's last run ("ran 5m ago" / failed / stopped) regardless of where it was launched.

## Scheduling

Add a **Workflow** step to a Scheduled task to run one on a timer (see Scheduled Tasks & Monitors).

## Notes

- Draft and disabled workflows never appear in the `/` command palette.
- A workflow run executes with the same permission discipline as any expert turn — it does not get extra permissions by virtue of being a workflow.
