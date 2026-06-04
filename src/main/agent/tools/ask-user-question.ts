// AskUserQuestion tool — pause and ask the user to clarify intent before acting. Use when the request is
// ambiguous, several approaches are valid, or a choice is genuinely the user's to make (not one the agent
// can settle from context). Pairs with the plan-first doctrine: ask in the planning phase, don't guess.

import { z } from 'zod'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'

const inputSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  header: z.string().max(12).optional().describe('A very short label for the question (max 12 chars)'),
  options: z.array(z.string()).min(2).max(4).describe('2-4 distinct, mutually-exclusive options to choose from')
})

export const askUserQuestionTool = buildTool<typeof inputSchema, string>({
  name: 'AskUserQuestion',
  inputSchema,
  prompt: () =>
    'Ask the user a multiple-choice question to clarify intent BEFORE acting. Use it when the request is ' +
    'ambiguous, there are several valid approaches, or the choice is genuinely the user\'s to make (not ' +
    'one you can settle from the code or context). Give 2-4 distinct options. The user can also answer ' +
    'freeform. Returns the answer they chose. Do NOT use it for things you can decide yourself.',
  isReadOnly: () => true, // asking mutates nothing
  isConcurrencySafe: () => false, // one question at a time — it blocks on the user
  async call(input, ctx) {
    if (!ctx.askUser) throw new Error('Asking the user is not available in this context (no interactive user).')
    const answer = await ctx.askUser(
      { question: input.question, header: input.header, options: input.options },
      ctx.signal
    )
    return { data: answer }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    return { type: 'tool_result', tool_use_id: toolUseId, content: `The user answered: ${out}` }
  }
})
