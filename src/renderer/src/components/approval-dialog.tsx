// ApprovalDialog — a centered floating card asking the user to approve a mutating tool before Engineer
// runs it. Visual design from claude.ai/design: title "Engineer wants to run <Tool>" (tool in accent), an
// optional reason line, the tool input as a mono code block, and Deny (ghost, Esc) / Allow (accent,
// Enter) buttons. Keyboard: Enter approves, Esc denies. Styles in styles/agent.css.

import { useEffect } from 'react'
import type { ReactElement } from 'react'
import type { PermissionPrompt } from '@/stores/chat'
import { STUDIO_DATA } from '@/data/studio-data'

// Render the tool input as a readable command / path block (full JSON only as a fallback).
function formatInput(toolName: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>
  if (toolName === 'Bash') return String(obj.command ?? '')
  if (typeof obj.file_path === 'string' && typeof obj.content === 'string') {
    return `${obj.file_path}\n\n${obj.content.slice(0, 800)}`
  }
  if (typeof obj.file_path === 'string') return obj.file_path
  return JSON.stringify(input, null, 2).slice(0, 1000)
}

const TerminalIcon = (): ReactElement => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 9 12 4 17" />
    <line x1="12" y1="17" x2="20" y2="17" />
  </svg>
)

export function ApprovalDialog({
  prompt,
  onAllow,
  onDeny,
}: {
  prompt: PermissionPrompt
  onAllow: () => void
  onDeny: () => void
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onAllow()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onDeny()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAllow, onDeny])

  return (
    <div className="approval-overlay">
      <div className="approval-card">
        <div className="ap-head">
          <span className="ap-icon">
            <TerminalIcon />
          </span>
          <span className="ap-title">
            {STUDIO_DATA.EXPERT_BY_ID.engineer?.name ?? 'Flynn'} wants to run <span className="ap-tool">{prompt.toolName}</span>
          </span>
        </div>
        {prompt.reason ? <div className="ap-reason">{prompt.reason}</div> : null}
        <pre className="ap-input">{formatInput(prompt.toolName, prompt.input)}</pre>
        <div className="ap-actions">
          <button className="ap-deny" onClick={onDeny}>
            Deny <kbd>Esc</kbd>
          </button>
          <button className="ap-allow" onClick={onAllow}>
            Allow <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
