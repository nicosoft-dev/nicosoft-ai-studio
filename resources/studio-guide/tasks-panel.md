# Tasks Panel

The live-work drawer for the current conversation. Open it with ⌘J, or topbar → Workspace → Tasks.

## Sections

- **Live** — each working expert's to-do list with statuses To do / In progress / Done and a "{done}/{total} done" summary. In coordinator or group conversations the items group per expert; in a solo chat they list flat.
- **Scheduled runs** — scheduled tasks running right now that belong to this conversation: current step (k/n) and a **Stop** button that aborts the chain.
- **Workflows** — workflow runs launched *from this conversation*: status at a glance, click to open the full run panel.
- **Studio Lens** — findings when an expert runs a code review: each finding carries a verdict — Pass, Flagged or False positive.
- **Services** — dev servers the experts started: Starting / Running / Exited, with **Stop** and **Logs** ("waiting for port" while booting).
- **Background** — everything else this conversation is running behind the scenes, one row each with a stop/cancel button: background operations an expert launched (`launch_async` — long scripts, e2e runs, detached reviews), running **Monitors** (the non-LLM watchers that wake the agent on change; the Scheduled page keeps the cross-conversation view), and pending **self-scheduled wakeups** with their fire time. When an operation finishes, its result arrives in the chat as the expert resumes — the row simply leaves the list.
- **History** — settled workflow runs and scheduled runs persist here; a scheduled run expands into its per-step trail (kind, exit code, duration, output snippet), and workflow entries reopen as full replays. **Clear** empties the list.

## Notes

- Stopping an expert's background work from here (a service, a monitor, a pending wakeup, an async operation or a launched workflow run) also tells the expert: it receives a system note that the user stopped it, so it won't keep waiting on — or silently restart — something you cancelled.
- "No task list for this chat." simply means no expert has planned steps yet.
- Ownership is per conversation: a run launched from another conversation shows in *that* conversation's panel. The Workflows view in the sidebar always shows everything.
