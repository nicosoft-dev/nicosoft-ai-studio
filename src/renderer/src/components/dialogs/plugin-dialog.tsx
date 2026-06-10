/* — Install plugin dialog — */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Modal } from '@/components/modal'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useT } from '@/stores/locale'

export function PluginDialog({
  onClose,
  onInstalled
}: {
  onClose: () => void
  onInstalled: () => void
}): ReactElement {
  const t = useT()
  const [dirPath, setDirPath] = useState('')
  const [installing, setInstalling] = useState(false)
  const [err, setErr] = useState('')

  const pickDir = async (): Promise<void> => {
    const p = await window.api.plugins.pickDir()
    if (p) {
      setDirPath(p)
      setErr('')
    }
  }

  const install = async (): Promise<void> => {
    if (!dirPath.trim()) return
    setInstalling(true)
    setErr('')
    try {
      await window.api.plugins.install(dirPath.trim())
      onInstalled()
    } catch (e) {
      setErr(ipcErrorMessage(e))
      setInstalling(false)
    }
  }

  return (
    <Modal
      title={t('plugin.title')}
      onClose={onClose}
      foot={
        <>
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary sm" onClick={() => void install()} disabled={!dirPath.trim() || installing}>
            {installing ? t('plugin.installing') : t('plugin.install')}
          </button>
        </>
      }
    >
      <div>
        <label className="field-label">
          {t('plugin.folder')} <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>· {t('plugin.folderHint')}</span>
        </label>
        <div className="skill-pickrow">
          <input className="input mono" value={dirPath} onChange={(e) => setDirPath(e.target.value)} placeholder={t('plugin.folderPlaceholder')} />
          <button className="btn secondary sm" onClick={() => void pickDir()}>
            {t('plugin.browse')}
          </button>
        </div>
      </div>
      <div className="scope-note">{t('plugin.note')}</div>
      {err ? (
        <div className="dialog-err">
          <Icons.alert size={14} /> {err}
        </div>
      ) : null}
    </Modal>
  )
}
