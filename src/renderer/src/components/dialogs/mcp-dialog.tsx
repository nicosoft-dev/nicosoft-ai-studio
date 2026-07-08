/* — Add / Edit MCP server dialog (controlled) — */
// Extensions (MCP + Skills) run inside an expert's agent loop — every built-in expert has one today,
// coordinator-direct included (read-only kit, Skill/MCP injected). Scope only picks WHICH experts are
// offered the capability on their runs.
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Modal } from '@/components/modal'
import { Segmented } from '@/components/primitives'
import { ScopePicker } from '@/components/scope-picker'
import { toast } from '@/stores/toast'
import { useT } from '@/stores/locale'
import type { McpServerDto, McpServerInput, McpTransport } from '@/lib/api'

export function McpDialog({
  initial,
  onClose,
  onSaved
}: {
  initial?: McpServerDto | null
  onClose: () => void
  onSaved: () => void
}): ReactElement {
  const t = useT()
  const [name, setName] = useState(initial?.name ?? '')
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? 'stdio')
  const [endpointOrCmd, setEndpointOrCmd] = useState(initial?.endpointOrCmd ?? '')
  const [argsText, setArgsText] = useState((initial?.args ?? []).join(' '))
  const [secretsText, setSecretsText] = useState('')
  const [scopeAll, setScopeAll] = useState(initial ? initial.scope === 'all' : true)
  const [scopeRoles, setScopeRoles] = useState<string[]>(Array.isArray(initial?.scope) ? initial.scope : [])
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonErr, setJsonErr] = useState('')
  const editing = !!initial

  const buildInput = (): McpServerInput => {
    const secrets: Record<string, string> = {}
    for (const line of secretsText.split('\n')) {
      const m = line.match(/^\s*([^=\s]+)\s*=\s*(.*)$/)
      if (m) secrets[m[1]] = m[2].trim()
    }
    return {
      name: name || 'Untitled',
      transport,
      endpointOrCmd: endpointOrCmd.trim(),
      args: transport === 'stdio' ? argsText.split(/\s+/).filter(Boolean) : [],
      scope: scopeAll ? 'all' : scopeRoles,
      enabled: initial?.enabled ?? true,
      ...(Object.keys(secrets).length ? { secrets } : {})
    }
  }

  const save = async (): Promise<void> => {
    try {
      if (initial) await window.api.mcp.update(initial.id, buildInput())
      else await window.api.mcp.add(buildInput())
      toast.success(t('mcp.serverSaved'))
      onSaved()
    } catch {
      toast.error(t('mcp.saveFailed'))
    }
  }

  const test = async (): Promise<void> => {
    if (!initial) {
      setTestState('fail')
      setTestMsg(t('mcp.testFirst'))
      return
    }
    setTestState('testing')
    setTestMsg('')
    try {
      await window.api.mcp.update(initial.id, buildInput()) // pick up edits before testing
      const r = await window.api.mcp.test(initial.id)
      if (r.ok) {
        setTestState('ok')
        setTestMsg(t('mcp.toolCount', { count: r.toolCount ?? 0 }))
        toast.success(t('mcp.connectionSuccessful'))
      } else {
        setTestState('fail')
        setTestMsg(r.error ?? t('mcp.connectionFailed'))
        toast.error(t('mcp.connectionFailed'))
      }
    } catch {
      setTestState('fail')
      setTestMsg(t('mcp.connectionFailed'))
      toast.error(t('mcp.connectionFailed'))
    }
  }

  // Parse a pasted `{ "mcpServers": { "<name>": {…} } }` config (the standard MCP server config
  // format) — or a bare single-server object — and fill the form fields. Lets users copy from any MCP
  // server's docs instead of re-typing command/args by hand. Secrets (env/headers) flow into the same
  // keychain-bound textarea as manual entry.
  const applyJson = (): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      setJsonErr(t('mcp.notValidJson'))
      return
    }
    if (!parsed || typeof parsed !== 'object') {
      setJsonErr(t('mcp.expectedObject'))
      return
    }
    let serverName = ''
    let cfg = parsed as Record<string, unknown>
    const wrapped = (parsed as Record<string, unknown>).mcpServers
    if (wrapped && typeof wrapped === 'object') {
      const entries = Object.entries(wrapped as Record<string, unknown>)
      if (!entries.length) {
        setJsonErr(t('mcp.noServerFound'))
        return
      }
      serverName = entries[0][0]
      cfg = entries[0][1] as Record<string, unknown>
    }
    const cmd = typeof cfg.command === 'string' ? cfg.command.trim() : ''
    const url = typeof cfg.url === 'string' ? cfg.url.trim() : ''
    if (!cmd && !url) {
      setJsonErr(t('mcp.needsCommandOrUrl'))
      return
    }
    const kvLines = (obj: unknown): string =>
      obj && typeof obj === 'object'
        ? Object.entries(obj as Record<string, unknown>)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join('\n')
        : ''
    if (cmd) {
      setTransport('stdio')
      setEndpointOrCmd(cmd)
      setArgsText(Array.isArray(cfg.args) ? (cfg.args as unknown[]).map(String).join(' ') : '')
      setSecretsText(kvLines(cfg.env))
    } else {
      setTransport('http')
      setEndpointOrCmd(url)
      setSecretsText(kvLines(cfg.headers))
    }
    if (serverName && !name.trim()) setName(serverName)
    setJsonErr('')
    setJsonText('')
    setJsonOpen(false)
  }

  const toggleRole = (id: string): void =>
    setScopeRoles((rs) => (rs.includes(id) ? rs.filter((r) => r !== id) : [...rs, id]))

  return (
    <Modal
      title={editing ? t('mcp.editTitle') : t('mcp.addTitle')}
      onClose={onClose}
      foot={
        <>
          <button className="btn secondary sm" onClick={() => void test()} disabled={testState === 'testing'}>
            {testState === 'testing' ? t('mcp.testing') : t('mcp.testConnection')}
          </button>
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary sm" onClick={() => void save()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="mcp-json">
        <button type="button" className="mcp-json-toggle" onClick={() => setJsonOpen((o) => !o)}>
          {jsonOpen ? '−' : '+'} {t('mcp.pasteConfig')}
        </button>
        {jsonOpen ? (
          <div className="mcp-json-body">
            <textarea
              className="input mono"
              rows={3}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value)
                if (jsonErr) setJsonErr('')
              }}
              placeholder={'{ "mcpServers": { "shadcn": { "command": "npx", "args": ["shadcn@latest", "mcp"] } } }'}
            />
            <div className="mcp-json-foot">
              {jsonErr ? (
                <span className="mcp-json-err">
                  <Icons.alert size={12} /> {jsonErr}
                </span>
              ) : (
                <span className="mcp-json-hint">{t('mcp.configHint')}</span>
              )}
              <button className="btn secondary sm" onClick={applyJson} disabled={!jsonText.trim()}>
                {t('mcp.fillFields')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div>
        <label className="field-label">{t('mcp.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" />
      </div>
      <div>
        <label className="field-label">{t('mcp.transport')}</label>
        <Segmented
          options={[
            { v: 'stdio', l: t('mcp.stdioLocal') },
            { v: 'http', l: t('mcp.http') }
          ]}
          value={transport}
          onChange={(v) => setTransport(v as McpTransport)}
        />
      </div>
      <div>
        <label className="field-label">{transport === 'stdio' ? t('mcp.command') : t('mcp.url')}</label>
        <input
          className="input mono"
          value={endpointOrCmd}
          onChange={(e) => setEndpointOrCmd(e.target.value)}
          placeholder={transport === 'stdio' ? t('mcp.commandPlaceholder') : t('mcp.urlPlaceholder')}
        />
        {/* Same red network line as the agent-install confirmation (extension-install §5.4) — the two
            install paths must warn identically for npx-style commands that fetch at connect time. */}
        {transport === 'stdio' && /(^|\/)(npx|uvx|pipx|bunx)$/.test(endpointOrCmd.trim().split(/\s+/)[0] ?? '') ? (
          <div className="ap-install-net" style={{ marginTop: 6 }}>{t('ext.mcpNetWarn')}</div>
        ) : null}
      </div>
      {transport === 'stdio' ? (
        <div>
          <label className="field-label">
            {t('mcp.arguments')} <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>· {t('mcp.argsHint')}</span>
          </label>
          <input
            className="input mono"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder="-y @modelcontextprotocol/server-filesystem /path"
          />
        </div>
      ) : null}
      <div>
        <label className="field-label">
          {transport === 'stdio' ? t('mcp.environment') : t('mcp.headers')}{' '}
          <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>· {t('mcp.secretsHint')}</span>
        </label>
        <textarea
          className="input mono"
          rows={2}
          value={secretsText}
          onChange={(e) => setSecretsText(e.target.value)}
          placeholder={
            editing ? t('mcp.secretsUnchanged') : transport === 'stdio' ? 'API_TOKEN=…' : 'Authorization=Bearer …'
          }
        />
      </div>
      <ScopePicker scopeAll={scopeAll} onScopeAll={setScopeAll} scopeRoles={scopeRoles} onToggleRole={toggleRole} />
      {testState === 'ok' && (
        <div className="test-success">
          <Icons.check size={15} /> {t('mcp.connected')} · {testMsg}
        </div>
      )}
      {testState === 'fail' && (
        <div className="rb-needs">
          <Icons.alert size={14} /> {testMsg}
        </div>
      )}
    </Modal>
  )
}
