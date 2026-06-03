// Offline verify for the OpenAI Responses agent adapter's wire translation (no network):
// AgentMessage content blocks → Responses input items, and AnyToolSchema → function tools.
// Run: npx tsx e2e/openai-agent-translate.ts
import { strict as assert } from 'node:assert'
import { toInput, toOpenAITools } from '../src/main/agent/llm-openai'
import type { AgentMessage, AnyToolSchema, ServerBlock } from '../src/main/agent/types'

// 1. tools: ToolSchema → function; ServerToolSchema (tool_search) skipped.
const tools: AnyToolSchema[] = [
  { name: 'read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
  { type: 'tool_search_tool_regex', name: 'tool_search' }
]
const fnTools = toOpenAITools(tools) as Array<Record<string, unknown>>
console.log('tools →', JSON.stringify(fnTools))
assert.equal(fnTools.length, 1, 'only the function tool; tool_search (server) skipped')
assert.equal(fnTools[0].type, 'function')
assert.equal(fnTools[0].name, 'read')
assert.ok(fnTools[0].parameters, 'parameters = input_schema')
assert.equal(fnTools[0].strict, false)
console.log('✓ toOpenAITools: ToolSchema→function, ServerToolSchema skipped')

// 2. input: a multi-turn conversation with text / tool_use / tool_result / reasoning round-trip.
const messages: AgentMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'check the weather' }] },
  {
    role: 'assistant',
    content: [
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC...' } as ServerBlock,
      { type: 'text', text: 'let me check' },
      { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'BJ' } }
    ]
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'sunny 25C' }] }
]
const input = toInput(messages) as Array<Record<string, unknown>>
console.log('input →', JSON.stringify(input))

// user turn → message(input_text)
assert.equal(input[0].type, 'message')
assert.equal(input[0].role, 'user')
assert.equal((input[0].content as Array<Record<string, unknown>>)[0].type, 'input_text')

// assistant turn → reasoning (verbatim) → message(output_text) → function_call, in that order
assert.equal(input[1].type, 'reasoning', 'reasoning item emitted first (round-trip)')
assert.equal(input[1].encrypted_content, 'ENC...', 'encrypted_content carried verbatim')
assert.equal(input[2].type, 'message')
assert.equal((input[2].content as Array<Record<string, unknown>>)[0].type, 'output_text')
assert.equal(input[3].type, 'function_call')
assert.equal(input[3].call_id, 'call_1')
assert.equal(input[3].name, 'get_weather')
assert.equal(input[3].arguments, JSON.stringify({ city: 'BJ' }))

// user tool_result turn → function_call_output (call_id paired)
assert.equal(input[4].type, 'function_call_output')
assert.equal(input[4].call_id, 'call_1')
assert.equal(input[4].output, 'sunny 25C')

console.log('✓ toInput: text→message · tool_use→function_call · tool_result→function_call_output · reasoning round-trip + order')
console.log('\n✓ ALL OpenAI adapter translation checks passed')
