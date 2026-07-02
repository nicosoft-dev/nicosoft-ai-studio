import { useEffect, type ReactElement } from 'react'
import { useT } from '@/stores/locale'
import { acquireGitStatus, gitAction, useGitStatus } from '@/stores/git-status'

/* Composer git chip + state-dependent action button (workspace-git-diff §5.2): `+A −D` for the CC-style
   merge-base span (uncommitted + unpushed together — the counts persist after a commit until the push),
   then ONE button — dirty → "Commit changes", clean-but-unpushed → "Push / PR". The button hands the WORK
   to the conversation's agent: a visible preset instruction through the composer's normal send path,
   auditable in chat — never a mechanical main-process commit (§1). Presets are distilled from CC's own
   commit/PR instructions (§10.5). */

export const COMMIT_PRESET =
  'Commit the current changes. First run git status, git diff and git log (recent messages) in parallel to see what changed and match this repo\'s commit style; then stage the relevant files by name (avoid `git add -A`; skip anything that looks like a secret) and commit with a concise message focused on the "why". If a pre-commit hook fails, fix the issue and create a NEW commit — never amend. Commit only — do not push.'

export const PUSH_PRESET =
  'Push the local commits. On a feature branch with a remote: push (set upstream if missing) and open a PR with gh pr create — title under 70 characters, body with a short Summary and a Test plan. On a mainline branch (main/develop): just push.'

export function GitStatusChip({
  cwd,
  disabled,
  onAction
}: {
  cwd: string | null
  disabled: boolean
  onAction: (preset: string) => void
}): ReactElement | null {
  const t = useT()
  const status = useGitStatus((s) => (cwd ? s.statusByCwd[cwd] : undefined))
  // Hold a chip-tier polling ref while mounted on a cwd (5 s ticks onto main's memos — §4).
  useEffect(() => {
    if (!cwd) return
    return acquireGitStatus(cwd, 'chip')
  }, [cwd])
  const action = gitAction(status)
  if (!status || !action) return null
  const showCounts = status.additions > 0 || status.deletions > 0
  return (
    <div className="git-chip" title={status.branch ?? undefined}>
      {showCounts ? (
        <span className="git-chip-counts">
          <span className="git-add">+{status.additions}</span>
          <span className="git-del">−{status.deletions}</span>
        </span>
      ) : null}
      <button
        className="git-chip-act"
        disabled={disabled}
        onClick={() => onAction(action === 'commit' ? COMMIT_PRESET : PUSH_PRESET)}
      >
        {action === 'commit' ? t('git.commitChanges') : t('git.pushPr')}
      </button>
    </div>
  )
}
