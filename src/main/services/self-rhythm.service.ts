// self-rhythm.service.ts — the model's own pacing. Where the scheduler fires on a cron/clock the user set, this
// lets the AGENT decide WHEN to wake itself next: it picks a delay, and at that delay its given prompt is
// injected back into THIS conversation via the unified session bus — the same wakeup primitive Monitor / hooks
// use. delaySeconds is clamped at the runtime to [60, 3600] (the verified bound). While a wakeup is pending the
// session is kept alive (a collaboration won't quiesce out from under a self-scheduled wake; a solo conv stays
// resumable), released when it fires or is cancelled.

import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'node:timers'
import { BrowserWindow } from 'electron'
import { ulid } from '../db/id'
import { sessionBus } from '../agent/session-bus'
import type { RhythmWakeupDto } from '../ipc/contracts'

const MIN_DELAY_S = 60
const MAX_DELAY_S = 3600

interface Wakeup {
  id: string
  convId: string
  prompt: string
  delayMs: number
  recurring: boolean
  roleId?: string
  fireAt: number // epoch ms of the NEXT fire — re-stamped on each recurring re-arm (Tasks panel countdown)
  timer: ReturnType<typeof nodeSetTimeout>
}

// rhythm:changed — nudge the Tasks panel's Background section to refetch (same fetch-on-event pattern as
// monitor:changed; the list is tiny and conv-scoped, so a payloadless nudge is enough).
function broadcastRhythmChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('rhythm:changed')
}

class SelfRhythmService {
  private wakeups = new Map<string, Wakeup>()

  // Arm a self-wakeup: fire `prompt` back into `convId` after the (clamped) delay. recurring=true RE-ARMS with the
  // same prompt+delay after each fire — a sustained, fixed-interval self-paced loop that runs until cancel() or
  // conv-dispose (the autonomous-loop capability). For a DYNAMIC loop the model instead re-calls schedule with a
  // fresh delay each wake. Returns the id + actual (clamped) delay.
  schedule(convId: string, prompt: string, delaySeconds: number, opts?: { roleId?: string; recurring?: boolean }): { id: string; delaySeconds: number } {
    const clamped = Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, Math.round(delaySeconds)))
    const id = ulid()
    sessionBus.addKeepalive(convId, `wakeup:${id}`) // hold the session open until the wake fires (held across re-arms when recurring)
    const w: Wakeup = {
      id,
      convId,
      prompt,
      delayMs: clamped * 1000,
      recurring: opts?.recurring === true,
      roleId: opts?.roleId,
      fireAt: Date.now() + clamped * 1000,
      timer: nodeSetTimeout(() => this.fire(id), clamped * 1000),
    }
    this.wakeups.set(id, w)
    broadcastRhythmChanged()
    console.log(`[self-rhythm] scheduled wakeup id=${id} conv=${convId} in=${clamped}s recurring=${w.recurring}`)
    return { id, delaySeconds: clamped }
  }

  // Pending wakeups for one conversation — the Tasks panel's Background section (read-only view).
  list(convId: string): RhythmWakeupDto[] {
    const out: RhythmWakeupDto[] = []
    for (const w of this.wakeups.values()) {
      if (w.convId !== convId) continue
      out.push({
        id: w.id,
        convId: w.convId,
        roleId: w.roleId,
        fireAt: w.fireAt,
        recurring: w.recurring,
        promptPreview: w.prompt.length > 120 ? w.prompt.slice(0, 120) + '…' : w.prompt,
      })
    }
    return out.sort((a, b) => a.fireAt - b.fireAt)
  }

  // Fire a wakeup: inject the prompt; a recurring wakeup then re-arms (keepalive stays held), a one-shot cleans up.
  private fire(id: string): void {
    const w = this.wakeups.get(id)
    if (!w) return
    void sessionBus.inject(w.convId, { text: w.prompt, source: `self-rhythm:${id}`, priority: 'later', roleId: w.roleId })
    if (w.recurring) {
      w.timer = nodeSetTimeout(() => this.fire(id), w.delayMs) // next tick; keepalive held until cancel/dispose
      w.fireAt = Date.now() + w.delayMs
    } else {
      this.wakeups.delete(id)
      sessionBus.removeKeepalive(w.convId, `wakeup:${id}`)
    }
    broadcastRhythmChanged()
  }

  cancel(id: string): boolean {
    const w = this.wakeups.get(id)
    if (!w) return false
    nodeClearTimeout(w.timer)
    this.wakeups.delete(id)
    sessionBus.removeKeepalive(w.convId, `wakeup:${id}`)
    broadcastRhythmChanged()
    return true
  }

  disposeForConv(convId: string): void {
    for (const w of [...this.wakeups.values()]) if (w.convId === convId) this.cancel(w.id)
  }

  disposeAll(): void {
    for (const w of [...this.wakeups.values()]) this.cancel(w.id)
  }
}

export const selfRhythmService = new SelfRhythmService()
