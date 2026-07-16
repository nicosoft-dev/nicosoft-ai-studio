// breakdown-compute.ts — on-demand context breakdown for a conversation, OUTSIDE a run.
//
// CC's /context panel enumerates the prompt's parts and counts each one the moment the panel opens (free
// count_tokens, haiku fallback) — it never waits for a turn. Studio's breakdown used to exist only as a
// turn side-product, so a conversation whose last turn predates the app session (or the persistence
// column) answered the ring click with "details appear after the next turn". This module closes that gap:
// rebuild the same request materials a run would send (system prompt, tool schemas, seed) and run the same
// four-probe differencing (countBreakdown), then persist the result like a turn would have.
//
// The materials mirror agent.service.run's construction (kept in sync by hand — a drift shows up only as
// a slightly-off Estimated panel, never a wrong run): recall is replaced by the side-effect-free
// recallForCount (no paid filter, no decay touch), thinking is omitted, and the total is our own
// measurement, so `anchored` stays false — the panel says "Estimated", which it is.
import * as convRepo from '../repos/conversation.repo'
import * as endpointRepo from '../repos/endpoint.repo'
import * as summaryRepo from '../repos/summary.repo'
import * as rolesService from './roles.service'
import { requireApiKey } from './credentials'
import { recallText } from './memory/project-map'
import { indexText as agentMemoryIndexText } from './memory/agent-memory'
import { recallForCount } from './memory/service'
import { manager as skillManager } from './extensions/skill'
import { DEV_ROLES, PLAYWRIGHT_TOOLS, SERVICE_TOOLS, SUBAGENT_TOOLS, toolsForAgentRole } from './agent-tools'
import { buildAgentSystem } from './agent-system'
import { conversationToAgentMessages } from './agent-dispatch'
import { buildToolsParam } from '../agent/loop'
import { launchAsyncTool } from '../agent/tools/launch-async'
import { awaitAsyncTool } from '../agent/tools/await-async'
import { lspTool } from '../agent/tools/lsp'
import type { Tool } from '../agent/tool'
import { protocolFamily } from '@shared/thinking'
import { countBreakdown, countContext, type ContextBreakdown } from './token-count.service'
import { sessionBus } from '../agent/session-bus'

// One computation per conversation at a time — the composer fires on open and there is nothing to gain
// from a second concurrent probe set for the same rows.
const inflight = new Map<string, Promise<ContextBreakdown | null>>()

export function computeForConversation(convId: string, contextWindow: number): Promise<ContextBreakdown | null> {
  const running = inflight.get(convId)
  if (running) return running
  const p = compute(convId, contextWindow)
    .catch(() => null) // a failed probe set means "no panel detail", never an error surface
    .finally(() => inflight.delete(convId))
  inflight.set(convId, p)
  return p
}

async function compute(convId: string, contextWindow: number): Promise<ContextBreakdown | null> {
  if (contextWindow <= 0) return null
  if (sessionBus.isActive(convId)) return null // a live run will measure and persist its own
  const conv = convRepo.getById(convId)
  if (!conv?.primaryRoleId) return null
  const roleId = conv.primaryRoleId
  const binding = rolesService.getBinding(roleId)
  if (!binding?.endpointId || !binding.model) return null
  const ep = endpointRepo.getById(binding.endpointId)
  if (!ep) return null
  const protocol = protocolFamily(ep.protocol)
  if (!protocol) return null
  let key: string
  try {
    key = requireApiKey(binding.endpointId)
  } catch {
    return null // key unreadable → nothing to probe with
  }

  // Materials, mirroring agent.service.run ①-③ (minus hooks/persistence): memories via the count-only
  // recall, history after the summary boundary, the role's tool kit with the DEV augmentation and the
  // folder-less Read drop, schemas WITHOUT server tools (the same counting kit agent.service probes with).
  const memories = recallForCount(roleId)
  const history = convRepo.listByConversation(convId)
  const summary = summaryRepo.getLatest(convId)
  const recent = summary?.coveredUpTo != null ? history.filter((m) => m.id > summary.coveredUpTo!) : history
  if (!recent.length) return null // nothing measurable yet — the panel's note is the honest answer
  const cwd = conv.cwd ?? ''
  const [projectMapText, memoryIndexText] = await Promise.all([recallText(cwd), agentMemoryIndexText(cwd)])
  const system = buildAgentSystem(roleId, memories, summary?.content ?? null, skillManager.listingForRole(roleId), cwd, false, projectMapText, memoryIndexText, false)
  const systemNoMemory = buildAgentSystem(roleId, [], summary?.content ?? null, skillManager.listingForRole(roleId), cwd, false, projectMapText, undefined, false)
  let tools: Tool[] = [...toolsForAgentRole(roleId), launchAsyncTool, awaitAsyncTool]
  if (DEV_ROLES.has(roleId)) tools = [...tools, ...SERVICE_TOOLS, ...PLAYWRIGHT_TOOLS, ...SUBAGENT_TOOLS, lspTool as unknown as Tool]
  if (!cwd && !DEV_ROLES.has(roleId)) tools = tools.filter((t) => t.name !== 'Read')
  const toolSchemas = buildToolsParam(tools, binding.model)
  const mapped = conversationToAgentMessages(recent)
  const firstUser = mapped.findIndex((m) => m.role === 'user')
  const seed = firstUser > 0 ? mapped.slice(firstUser) : mapped
  if (!seed.length) return null

  const input = { baseUrl: ep.baseUrl, apiKey: key, model: binding.model, system, messages: seed as { role: string; content: unknown }[], tools: toolSchemas }
  const total = await countContext(protocol, input)
  if (total <= 0) return null
  const b = await countBreakdown(protocol, input, { systemNoMemory, total, max: contextWindow, anchored: false })
  if (b) convRepo.setContextBreakdown(convId, JSON.stringify(b))
  return b
}
