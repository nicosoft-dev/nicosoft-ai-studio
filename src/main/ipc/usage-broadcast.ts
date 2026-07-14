// Single place every IPC path (chat / agent / coordinator / image) reports per-conversation usage from.
// Three `kind`s flow through here (see ConvUsage):
//   • 'context' — the current context size (count_tokens of the turn being sent), measured up front per
//     turn → drives the composer's "/ window" indicator.
//   • 'live' — the in-flight request's own ↑prompt size / ↓running output (overwrite per request, never
//     summed across requests) → drives the live ↑/↓ readout only.
// They stay separate because they answer different questions ("how full is the window" vs "what is this
// request doing right now"), not because either accumulates. Keyed by convId — every path knows its
// convId, so we skip the streamId→conv indirection the done events use.
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import type { ContextBreakdown, ConvBreakdown, ConvCard, ConvTodos, ConvUsage, MessageAttachmentDto, MessageDto } from './contracts'

export function broadcastUsage(
  sender: WebContents,
  convId: string,
  kind: ConvUsage['kind'],
  inputTokens: number,
  outputTokens?: number,
  cacheReadInputTokens?: number,
  cacheCreationInputTokens?: number,
  roleId?: string,
): void {
  if (sender.isDestroyed()) return
  // outputTokens omitted (input-only ping: the up-front 'context' count, or a 'live' ping that carried no
  // output yet) → the renderer keeps the last real output; provided → it updates both. turn-final carries
  // cache details so the renderer can accumulate a cache-aware session total exactly once per request.
  // roleId (coordinator only): tags which dispatched step this usage belongs to, so the renderer routes the
  // live ↑/↓ to that segment instead of the conv-level overlay, and keeps sub-steps out of the /window meter.
  const ev: ConvUsage = { convId, kind, inputTokens }
  if (outputTokens !== undefined) ev.outputTokens = outputTokens
  if (cacheReadInputTokens !== undefined) ev.cacheReadInputTokens = cacheReadInputTokens
  if (cacheCreationInputTokens !== undefined) ev.cacheCreationInputTokens = cacheCreationInputTokens
  if (roleId !== undefined) ev.roleId = roleId
  sender.send('conv:usage', ev)
}

// What the current prompt is made of → the composer's Context window panel. Separate from broadcastUsage
// because it is computed OFF the hot path: the 'context' ping must reach the readout the moment the turn
// starts, while this lands a beat later, whenever the differencing probes settle.
export function broadcastBreakdown(sender: WebContents, convId: string, breakdown: ContextBreakdown): void {
  if (sender.isDestroyed()) return
  const ev: ConvBreakdown = { convId, breakdown }
  sender.send('conv:breakdown', ev)
}

// An agent tool generated an image (already persisted to the media store) — broadcast its nsai-media:// ref,
// keyed by convId like usage, so the renderer attaches it to the in-flight assistant bubble live. Base64
// never crosses IPC: the loop persisted the bytes and we send only the reference.
export function broadcastConvImage(sender: WebContents, convId: string, attachment: MessageAttachmentDto): void {
  if (sender.isDestroyed()) return
  sender.send('conv:image', { convId, attachment })
}

// The agent's TodoWrite list, pushed the MOMENT the tool executes (mid-turn). Without this the workspace
// Tasks panel only sees todos after the whole turn settles into the transcript — on a long turn (a 64K
// max_tokens escalation, a big multi-file edit) that's minutes of a frozen panel while the agent has
// already moved items to completed (dogfood round11).
export function broadcastConvTodos(sender: WebContents, convId: string, roleId: string, todos: ConvTodos['todos']): void {
  if (sender.isDestroyed()) return
  const ev: ConvTodos = { convId, roleId, todos }
  sender.send('conv:todos', ev)
}

// A workflow draft card row landed or changed (workflow-assisted-authoring §3.4). Unlike the per-sender
// helpers above, this goes to EVERY window (git-broadcast pattern): the appending turn may be running
// headless (a scheduled step) or in another window, and the card must appear / patch wherever the
// conversation is on screen. Windows whose store hasn't loaded the conversation ignore it.
export function broadcastConvCard(convId: string, message: MessageDto): void {
  const ev: ConvCard = { convId, message }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send('conv:card', ev)
  }
}
