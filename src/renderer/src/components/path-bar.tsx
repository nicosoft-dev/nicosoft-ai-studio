import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'

// Project-path selector — a folder chip + (when the folder is a git repo) a branch chip, above the
// composer. Controlled: the parent owns the cwd (per-role) and the folder-pick handler. No folder → a
// lone folder icon; folder with no git → just the folder chip (no branch / git icon).
export function PathBar({ cwd, onPick }: { cwd: string; onPick: (dir: string) => void }): ReactElement {
  const [branch, setBranch] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Refresh the current branch whenever the project changes; close any open branch menu.
  useEffect(() => {
    let alive = true
    setMenuOpen(false)
    if (!cwd) {
      setBranch(null)
      return
    }
    void window.api.project.branch(cwd).then((b) => {
      if (alive) setBranch(b)
    })
    return () => {
      alive = false
    }
  }, [cwd])

  const pickFolder = async (): Promise<void> => {
    const dir = await window.api.project.pick()
    if (dir) onPick(dir)
  }
  const toggleBranchMenu = async (): Promise<void> => {
    if (!cwd) return
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    setBranches(await window.api.project.branches(cwd))
    setMenuOpen(true)
  }
  const switchBranch = async (b: string): Promise<void> => {
    setMenuOpen(false)
    if (!cwd || b === branch || switching) return
    setSwitching(true)
    const ok = await window.api.project.checkout(cwd, b)
    setSwitching(false)
    if (ok) setBranch(b)
  }

  // Empty state — a single folder icon button (no long "Choose a project folder…" chip).
  if (!cwd) {
    return (
      <div className="path-bar">
        <button className="path-folder-btn" onClick={() => void pickFolder()} title="Choose a project folder">
          <Icons.folder size={15} />
        </button>
      </div>
    )
  }

  const name = cwd.split('/').filter(Boolean).pop() ?? cwd
  return (
    <div className="path-bar">
      <button className="path-chip" onClick={() => void pickFolder()} title={cwd}>
        <Icons.folder size={12} />
        <span className="path-chip-text">{name}</span>
      </button>
      {branch ? (
        <div className="path-branch">
          <button
            className={'path-chip' + (menuOpen ? ' active' : '')}
            onClick={() => void toggleBranchMenu()}
            title="Switch branch"
            disabled={switching}
          >
            <Icons.gitBranch size={12} />
            <span className="path-chip-text">{branch}</span>
            <Icons.chevronDown size={11} />
          </button>
          {menuOpen ? (
            <>
              <div className="path-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="path-branch-menu" role="listbox">
                {branches.length === 0 ? (
                  <div className="path-branch-empty">No branches</div>
                ) : (
                  branches.map((b) => (
                    <button
                      key={b}
                      className={'path-branch-item' + (b === branch ? ' current' : '')}
                      onClick={() => void switchBranch(b)}
                      role="option"
                      aria-selected={b === branch}
                    >
                      <span className="pbi-check">{b === branch ? <Icons.check size={13} /> : null}</span>
                      <span className="pbi-name">{b}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
