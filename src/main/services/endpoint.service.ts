import * as endpointRepo from '../repos/endpoint.repo'
import type { EndpointRow } from '../repos/endpoint.repo'
import * as keychain from '../keychain/keychain'
import { chat } from '../llm/client'
import { LlmError } from '../llm/types'
import type { EndpointDto, EndpointInput, EndpointTestResult } from '../ipc/contracts'

// Business layer: composes the endpoint repo (table) with the keychain (secrets) and the llm
// client (test connection). Never touches IPC; never writes SQL directly.

function toDto(row: EndpointRow): EndpointDto {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    availableModels: row.availableModels,
    enabled: row.enabled,
    createdAt: row.createdAt,
    hasKey: keychain.hasApiKey(row.id)
  }
}

export function list(): EndpointDto[] {
  return endpointRepo.list().map(toDto)
}

export function add(input: EndpointInput): EndpointDto {
  const row = endpointRepo.create({
    name: input.name,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    defaultModel: input.defaultModel ?? undefined,
    availableModels: input.availableModels ?? [],
    enabled: input.enabled ?? true
  })
  if (input.apiKey) keychain.setApiKey(row.id, input.apiKey)
  return toDto(row)
}

export function update(id: string, patch: Partial<EndpointInput>): EndpointDto | null {
  const row = endpointRepo.update(id, {
    name: patch.name,
    protocol: patch.protocol,
    baseUrl: patch.baseUrl,
    defaultModel: patch.defaultModel,
    availableModels: patch.availableModels,
    enabled: patch.enabled
  })
  if (!row) return null
  if (patch.apiKey) keychain.setApiKey(id, patch.apiKey)
  return toDto(row)
}

export function remove(id: string): void {
  endpointRepo.remove(id)
  keychain.deleteApiKey(id)
}

export async function test(id: string): Promise<EndpointTestResult> {
  const row = endpointRepo.getById(id)
  if (!row) return { ok: false, error: { code: 'not_found', message: 'endpoint not found' } }
  const key = keychain.getApiKey(id)
  if (!key) return { ok: false, error: { code: 'bad_key', message: 'no API key configured' } }
  const model = row.defaultModel || row.availableModels[0]
  if (!model) return { ok: false, error: { code: 'bad_request', message: 'no model configured to test' } }
  try {
    await chat(
      { protocol: row.protocol, baseUrl: row.baseUrl, apiKey: key, model, messages: [{ role: 'user', content: 'ping' }] },
      () => {}
    )
    return { ok: true }
  } catch (e) {
    if (e instanceof LlmError) return { ok: false, error: { code: e.code, message: e.message } }
    return { ok: false, error: { code: 'unknown', message: e instanceof Error ? e.message : String(e) } }
  }
}
