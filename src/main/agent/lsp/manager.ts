// LSPManager (batch 4 / doc 25) — a minimal Language Server Protocol client over stdio. It spawns
// typescript-language-server (--stdio) once per run, drives the initialize → initialized → didOpen
// handshake, and exposes four queries the lsp tool needs: definition, references, hover, diagnostics.
// Scope is TS/JS (the server's domain). The manager is owned by runAgentLoop and tree-killed on dispose,
// like the service registry — no language-server process outlives the run.
//
// Framing is LSP's own: "Content-Length: N\r\n\r\n" + a UTF-8 JSON-RPC body. Diagnostics aren't a request/
// response — the server PUSHES textDocument/publishDiagnostics after an open/change, so diagnostics() opens
// the doc then waits for the next push (with a timeout fallback). Positions cross the tool boundary 1-based
// (human/editor convention) and convert to LSP's 0-based here.

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { extname } from 'node:path'

// main is bundled CJS, so __dirname exists at runtime; createRequire lets us resolve the (external) server.
const lspRequire = createRequire(__dirname)

export interface LspLocation {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}
export interface LspDiagnostic {
  line: number
  col: number
  severity: string
  message: string
  source?: string
}
export interface LspHandle {
  definition(file: string, line: number, col: number): Promise<LspLocation[]>
  references(file: string, line: number, col: number): Promise<LspLocation[]>
  hover(file: string, line: number, col: number): Promise<string>
  diagnostics(file: string): Promise<LspDiagnostic[]>
}

export const LSP_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])

function languageId(file: string): string {
  switch (extname(file)) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript'
    case '.tsx':
      return 'typescriptreact'
    case '.jsx':
      return 'javascriptreact'
    default:
      return 'javascript'
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class LSPManager implements LspHandle {
  private proc?: ChildProcess
  private seq = 0
  private pending = new Map<number, Pending>()
  private buffer = Buffer.alloc(0)
  private contentLength = -1
  private diagnosticsByUri = new Map<string, LspDiagnostic[]>() // uri → latest pushed diagnostics
  private diagWaiters = new Map<string, (() => void)[]>()
  private opened = new Map<string, number>() // file → document version
  private ready?: Promise<void>

  constructor(private cwd: string) {}

  // --- lifecycle ---

  private ensure(): Promise<void> {
    if (!this.ready) this.ready = this.startServer()
    return this.ready
  }

  private async startServer(): Promise<void> {
    const cliPath = lspRequire.resolve('typescript-language-server/lib/cli.mjs')
    this.proc = spawn(process.execPath, [cliPath, '--stdio'], {
      cwd: this.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d))
    this.proc.stderr?.on('data', () => {}) // server diagnostics log; ignore
    this.proc.on('exit', () => this.failAllPending('LSP server exited'))
    this.proc.on('error', (e) => this.failAllPending(`LSP server failed to start: ${e.message}`))

    const rootUri = pathToFileURL(this.cwd).toString()
    await this.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'root' }],
      capabilities: {
        textDocument: {
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ['plaintext', 'markdown'] },
          publishDiagnostics: {},
          synchronization: { dynamicRegistration: false, didSave: false },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
    })
    this.notify('initialized', {})
  }

  dispose(): void {
    const proc = this.proc
    this.proc = undefined
    if (!proc) return
    this.failAllPending('LSP disposed')
    try {
      proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, 2000)
  }

  // --- queries ---

  async definition(file: string, line: number, col: number): Promise<LspLocation[]> {
    const uri = await this.openDoc(file)
    const result = await this.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: line - 1, character: col - 1 },
    })
    return toLocations(result)
  }

  async references(file: string, line: number, col: number): Promise<LspLocation[]> {
    const uri = await this.openDoc(file)
    const result = await this.request('textDocument/references', {
      textDocument: { uri },
      position: { line: line - 1, character: col - 1 },
      context: { includeDeclaration: true },
    })
    return toLocations(result)
  }

  async hover(file: string, line: number, col: number): Promise<string> {
    const uri = await this.openDoc(file)
    const result = await this.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: line - 1, character: col - 1 },
    })
    return hoverText(result)
  }

  async diagnostics(file: string): Promise<LspDiagnostic[]> {
    const uri = await this.openDoc(file) // open/change triggers a publishDiagnostics push
    await this.waitDiagnostics(uri, 4000)
    return this.diagnosticsByUri.get(uri) ?? []
  }

  // --- document sync ---

  private async openDoc(file: string): Promise<string> {
    await this.ensure()
    const uri = pathToFileURL(file).toString()
    const text = await readFile(file, 'utf8')
    const version = (this.opened.get(file) ?? 0) + 1
    this.opened.set(file, version)
    if (version === 1) {
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageId(file), version, text },
      })
    } else {
      // re-read from disk each query so edits between queries are reflected (full-text change).
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] })
    }
    return uri
  }

  private waitDiagnostics(uri: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const list = this.diagWaiters.get(uri) ?? []
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      list.push(done)
      this.diagWaiters.set(uri, list)
      setTimeout(done, timeoutMs) // fallback: the server may report no diagnostics (clean file)
    })
  }

  // --- LSP framing + JSON-RPC ---

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const header = this.buffer.subarray(0, headerEnd).toString('ascii')
        const m = header.match(/Content-Length:\s*(\d+)/i)
        this.contentLength = m ? Number(m[1]) : 0
        this.buffer = this.buffer.subarray(headerEnd + 4)
      }
      if (this.buffer.length < this.contentLength) return
      const body = this.buffer.subarray(0, this.contentLength).toString('utf8')
      this.buffer = this.buffer.subarray(this.contentLength)
      this.contentLength = -1
      try {
        this.onMessage(JSON.parse(body))
      } catch {
        /* malformed frame — skip */
      }
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    const id = typeof msg.id === 'number' ? msg.id : undefined
    // Response to one of our requests (has id, no method).
    if (id !== undefined && !msg.method) {
      const p = this.pending.get(id)
      if (p) {
        this.pending.delete(id)
        if (msg.error) p.reject(new Error((msg.error as { message?: string }).message ?? 'LSP error'))
        else p.resolve(msg.result)
      }
      return
    }
    // Pushed diagnostics.
    if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params as { uri: string; diagnostics?: unknown[] }
      this.diagnosticsByUri.set(params.uri, (params.diagnostics ?? []).map(toDiag))
      const waiters = this.diagWaiters.get(params.uri)
      if (waiters) {
        this.diagWaiters.delete(params.uri)
        waiters.forEach((w) => w())
      }
      return
    }
    // Server→client request (has id AND method) — reply so it doesn't block. configuration wants one
    // entry per requested item; everything else gets a null result.
    if (id !== undefined && msg.method) {
      if (msg.method === 'workspace/configuration') {
        const items = (msg.params as { items?: unknown[] })?.items ?? [{}]
        this.respond(
          id,
          items.map(() => ({}))
        )
      } else {
        this.respond(id, null)
      }
    }
    // Server→client notifications (window/logMessage etc.) are ignored.
  }

  private write(obj: unknown): void {
    if (!this.proc?.stdin) return
    const buf = Buffer.from(JSON.stringify(obj), 'utf8')
    this.proc.stdin.write(`Content-Length: ${buf.length}\r\n\r\n`)
    this.proc.stdin.write(buf)
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.seq
    this.write({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`LSP ${method} timed out`))
      }, 15000)
    })
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private respond(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  private failAllPending(message: string): void {
    for (const p of this.pending.values()) p.reject(new Error(message))
    this.pending.clear()
  }
}

// --- result mappers (LSP shapes → flat 1-based structures) ---

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

function toLocations(result: unknown): LspLocation[] {
  if (!result) return []
  const arr = (Array.isArray(result) ? result : [result]) as Record<string, unknown>[]
  const out: LspLocation[] = []
  for (const loc of arr) {
    const uri = (loc.uri ?? loc.targetUri) as string | undefined
    const range = (loc.range ?? loc.targetSelectionRange ?? loc.targetRange) as LspRange | undefined
    if (!uri || !range) continue
    out.push({
      file: fileURLToPath(uri),
      line: range.start.line + 1,
      col: range.start.character + 1,
      endLine: range.end.line + 1,
      endCol: range.end.character + 1,
    })
  }
  return out
}

function hoverText(result: unknown): string {
  const contents = (result as { contents?: unknown })?.contents
  if (!contents) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === 'string' ? c : ((c as { value?: string }).value ?? ''))).join('\n')
  }
  return (contents as { value?: string }).value ?? ''
}

const SEVERITY = ['', 'error', 'warning', 'info', 'hint']
function toDiag(d: unknown): LspDiagnostic {
  const diag = d as { range: LspRange; severity?: number; message: string; source?: string }
  return {
    line: diag.range.start.line + 1,
    col: diag.range.start.character + 1,
    severity: SEVERITY[diag.severity ?? 3] ?? 'info',
    message: diag.message,
    source: diag.source,
  }
}
