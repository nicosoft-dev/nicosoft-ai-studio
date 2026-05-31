import * as endpointRepo from '../repos/endpoint.repo'
import * as usageRepo from '../repos/usage.repo'
import * as keychain from '../keychain/keychain'
import { chat as llmChat } from '../llm/client'
import { LlmError } from '../llm/types'
import type { ChatResult } from '../llm/types'
import type { ChatSendInput } from '../ipc/contracts'

// Batch 1: minimal streaming — resolve endpoint + key, stream from the llm client, record usage.
// Conversation/message persistence and role→binding resolution land in Batch 2.
export async function send(
  input: ChatSendInput,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<ChatResult> {
  const ep = endpointRepo.getById(input.endpointId)
  if (!ep) throw new LlmError('bad_request', 'endpoint not found')
  const key = keychain.getApiKey(input.endpointId)
  if (!key) throw new LlmError('bad_key', 'no API key configured for this endpoint')

  const result = await llmChat(
    {
      protocol: ep.protocol,
      baseUrl: ep.baseUrl,
      apiKey: key,
      model: input.model,
      messages: input.messages,
      reasoning: input.reasoning,
      signal
    },
    (d) => onDelta(d.text)
  )

  usageRepo.record({
    model: input.model,
    provider: ep.protocol,
    inTokens: result.usage.inTokens,
    outTokens: result.usage.outTokens
  })

  return result
}
