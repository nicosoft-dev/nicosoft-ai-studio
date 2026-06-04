// Runtime verify for the markdown code-block fix (components/markdown.tsx). A bare ``` fence (no language)
// and an indented block carry no `language-*` class; react-markdown v10 drops the `inline` flag, so the old
// renderer mislabelled them as inline-code → a multi-line directory tree collapsed onto one line. This
// injects an assistant message exactly like Flynn's plan Structure and asserts the tree renders as a BLOCK
// (line breaks kept), while real inline code stays inline.   node e2e/markdown-render-e2e.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = [
  '### Structure',
  '',
  '```',
  'package.json',
  '.env.example',
  'src/',
  '  app.js          # express app (exported, no listen)',
  '  server.js       # starts the listener',
  '  db/',
  '    index.js      # sqlite connection',
  '  routes/',
  '    auth.routes.js   # POST /register, /login',
  '```',
  '',
  'Inline `foo.js` and `bar()` must stay inline.',
  '',
  '    // indented 4-space block',
  '    function x() {',
  '      return 42',
  '    }',
].join('\n')

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const convId = await page.evaluate(async (content) => {
  const conv = await window.api.conversations.create({ kind: 'single', primaryRoleId: 'engineer', title: 'MD Render Test' })
  await window.api.conversations.append(conv.id, { author: 'expert', expertId: 'engineer', model: 'test', content })
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  return conv.id
}, md)
console.log('convId:', convId)

await page.reload()
await page.waitForTimeout(1500)
// Frontend renders chat.activeConv — open the injected conversation from the History sidebar.
const row = page.locator('.hist-row', { hasText: 'MD Render Test' }).first()
await row.waitFor({ timeout: 5000 })
await row.click()
await page.waitForTimeout(1500)

const dom = await page.evaluate(() => {
  const codeEls = [...document.querySelectorAll('.md code, .md pre')]
  const find = (needle) => {
    const el = codeEls.find((e) => (e.textContent || '').includes(needle))
    if (!el) return null
    return {
      tag: el.tagName,
      cls: el.className,
      isInline: el.classList.contains('inline-code') || !!el.closest('.inline-code'),
      inBlock: !!el.closest('.code-block') || el.tagName === 'PRE' || !!el.closest('pre'),
      multiline: (el.textContent || '').includes('\n'),
      height: Math.round(el.getBoundingClientRect().height),
    }
  }
  return {
    inlineCodes: [...document.querySelectorAll('.inline-code')].map((e) => e.textContent),
    codeBlocks: document.querySelectorAll('.code-block').length,
    tree: find('package.json'),
    indented: find('function x'),
  }
})
console.log(JSON.stringify(dom, null, 2))
await page.screenshot({ path: '/tmp/markdown-render.png', fullPage: true })

const fails = []
if (!dom.tree) fails.push('directory tree not found in DOM')
else {
  if (dom.tree.isInline) fails.push('directory tree still rendered as inline-code (collapsed to one line)')
  if (!dom.tree.inBlock) fails.push('directory tree not inside a code block / <pre>')
  if (!dom.tree.multiline) fails.push('directory tree lost its line breaks')
}
if (dom.indented && dom.indented.isInline) fails.push('indented block rendered as inline-code')
if (!dom.inlineCodes.some((t) => t === 'foo.js')) fails.push('inline `foo.js` regressed (not inline anymore)')
if (dom.inlineCodes.some((t) => (t || '').includes('package.json'))) fails.push('tree leaked into an inline-code span')

console.log(fails.length ? '✗ FAIL:\n  - ' + fails.join('\n  - ') : '✓ PASS — bare-fence directory tree renders as a multi-line block; inline code stays inline')
await app.close()
process.exit(fails.length ? 1 : 0)
