// Install integrity (review round-4 P1-3). Two guarantees for the source folder of an install:
//   realDir  — resolve to the CANONICAL real path (root symlink followed), so a symlink sitting inside the
//              working folder can't be labeled "inside cwd" by the renderer's string-only check (the
//              renderer has no fs to realpath) and quietly install content from outside it. Preview and
//              install both operate on — and digest — the SAME real location.
//   digestDir — a stable content digest of the folder, computed at PREVIEW and re-computed at INSTALL. If
//              the source changed between the user reviewing the preview and the install running, the digests
//              differ → abort and install nothing (the review→install TOCTOU), rather than installing
//              something other than what was approved.

import { createHash } from 'node:crypto'
import { readdir, realpath, lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { MATERIALIZE_MAX_BYTES, MATERIALIZE_MAX_FILES } from './materialize'

// Canonical real path of a source directory (root symlink resolved). Throws if the path doesn't exist — the
// install callers already existence-check first, so a throw here is a genuinely vanished/broken source.
export async function realDir(dir: string): Promise<string> {
  return realpath(dir)
}

// sha256 over every REGULAR file's (relative-path, content), sorted so the result is independent of walk
// order. Applies the SAME skips materialize does — .git / .DS_Store / symlinks — because symlinks are never
// copied into the materialized payload, so hashing them would diverge from what actually installs. This is
// what binds the preview the user approved to the bytes the install writes.
//
// STREAMED, not buffered: collect the relative paths first (readdir yields names — no content read), sort
// them, then read + hash ONE FILE AT A TIME so peak memory is a single file, not the whole tree. It runs on
// the MAIN process at both preview (dialog open) and install, and a plugin/MCP folder can legitimately carry
// a large node_modules — buffering every file at once would spike RSS / freeze the app. It honors the SAME
// file-count / byte cap materialize enforces, so a mis-pointed source (a repo root, ~) is rejected cheaply
// (the count cap trips during the read-free walk) instead of being read at all.
export async function digestDir(dir: string): Promise<string> {
  const rels: string[] = []
  async function walk(d: string): Promise<void> {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue
      if (entry.isSymbolicLink()) continue // never copied → never hashed
      const p = join(d, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.isFile()) {
        rels.push(relative(dir, p).split(sep).join('/'))
        if (rels.length > MATERIALIZE_MAX_FILES) {
          throw new Error(`source folder exceeds the install limit (${MATERIALIZE_MAX_FILES.toLocaleString()} files) — point the install at the extension's own folder, not a parent directory`)
        }
      }
    }
  }
  await walk(dir)
  rels.sort()
  // Canonical, UNAMBIGUOUS framing: LENGTH-PREFIX every field so file boundaries can't be forged by content that
  // contains the separator. Without it a single file `a`="x\0b\0y" and two files `a`="x",`b`="y" both feed the
  // byte stream `a\0x\0b\0y\0` and collide. The file COUNT + each field's u32 length prefix make the stream
  // self-delimiting; the mode is folded in so an executable-bit flip (which changes run behavior) changes the
  // digest too. Still content-addressed sha256 — only the framing changed (the value is not persisted across
  // versions, only compared preview↔install within one run, so re-framing needs no migration).
  const h = createHash('sha256')
  const u32 = (n: number): Buffer => { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n >>> 0, 0); return b }
  h.update(u32(rels.length))
  let bytes = 0
  for (const rel of rels) {
    const abs = join(dir, rel) // node's join treats the posix '/' in rel as a separator on every OS
    // Enforce the single-file cap from lstat.size BEFORE reading, so a single ~2 GiB file is never pulled fully
    // into the main process just to discover it's over the limit (the count cap already tripped in the walk).
    const st = await lstat(abs)
    if (st.size > MATERIALIZE_MAX_BYTES) {
      throw new Error(`source folder exceeds the install limit (${Math.round(MATERIALIZE_MAX_BYTES / (1024 * 1024))} MB) — point the install at the extension's own folder, not a parent directory`)
    }
    // Length-prefixed framing (unchanged shape, still unambiguous): rel-path, mode, then the CONTENT length + bytes.
    // The content length is st.size (known from the lstat above), so the file is STREAMED chunk-by-chunk into the
    // hash — never buffered whole into the main process. That keeps peak memory at one chunk, so a legitimately
    // large file (up to the cap) can't spike RSS / freeze the app (#2). For a stable file st.size === bytes-read,
    // so the digest is byte-identical to the old readFile framing; a mid-read size change is a TOCTOU that the
    // preview↔install digest comparison is meant to catch anyway.
    const relBuf = Buffer.from(rel, 'utf8')
    h.update(u32(relBuf.length)); h.update(relBuf)
    h.update(u32(st.mode))
    h.update(u32(st.size))
    let fileBytes = 0
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(abs)
      stream.on('data', (chunk: Buffer) => { h.update(chunk); fileBytes += chunk.length })
      stream.on('error', reject)
      stream.on('end', resolve)
    })
    bytes += fileBytes
    if (bytes > MATERIALIZE_MAX_BYTES) {
      throw new Error(`source folder exceeds the install limit (${Math.round(MATERIALIZE_MAX_BYTES / (1024 * 1024))} MB) — point the install at the extension's own folder, not a parent directory`)
    }
  }
  return h.digest('hex')
}
