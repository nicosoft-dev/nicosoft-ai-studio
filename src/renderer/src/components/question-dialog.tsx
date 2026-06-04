// QuestionDialog — the agent paused to ask the user a multiple-choice question (AskUserQuestion). A
// centered floating card: an optional header chip, the question, 2-4 option buttons, and an "Other"
// free-text input. Picking an option (or submitting Other) answers it. Keyboard: 1-4 pick an option.
// Styles in styles/agent.css alongside ApprovalDialog.

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { QuestionPrompt } from '@/stores/chat'
import { STUDIO_DATA } from '@/data/studio-data'

export function QuestionDialog({
  prompt,
  onAnswer
}: {
  prompt: QuestionPrompt
  onAnswer: (answer: string) => void
}): ReactElement {
  const [other, setOther] = useState('')
  const name = (prompt.roleId && STUDIO_DATA.EXPERT_BY_ID[prompt.roleId]?.name) || 'The agent'
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= prompt.options.length) {
        e.preventDefault()
        onAnswer(prompt.options[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt, onAnswer])
  return (
    <div className="approval-overlay">
      <div className="approval-card">
        <div className="q-head">
          {prompt.header ? <span className="q-tag">{prompt.header}</span> : null}
          <span className="ap-title">{name} is asking</span>
        </div>
        <div className="q-question">{prompt.question}</div>
        <div className="q-options">
          {prompt.options.map((opt, i) => (
            <button key={i} className="q-option" onClick={() => onAnswer(opt)} type="button">
              <span className="q-num">{i + 1}</span>
              <span className="q-opt-text">{opt}</span>
            </button>
          ))}
        </div>
        <input
          className="q-other"
          placeholder="Or type another answer…"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && other.trim()) {
              e.preventDefault()
              onAnswer(other.trim())
            }
          }}
        />
      </div>
    </div>
  )
}
