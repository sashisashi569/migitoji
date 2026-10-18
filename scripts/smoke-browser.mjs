#!/usr/bin/env node
// Firefox (WebDriver BiDi) で実際に EPUB を描画し、組方向・見開き切替を検証する smoke test。
// 事前に `npm run dev` 等で静的サーバーを起動しておくか、--serve で自動起動する。
//
// 使い方: node scripts/smoke-browser.mjs [--port 8137] [--out /tmp/smoke.png] [--keep]
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const PORT = Number(argOf('--port', 8137))
const OUT = argOf('--out', '/tmp/opencode/migitoji-smoke.png')
const KEEP = args.includes('--keep')
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const log = (...a) => console.log('[smoke]', ...a)
const fail = msg => { console.error('[smoke] FAIL:', msg); process.exitCode = 1 }

const waitPort = async (port, timeoutMs = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await new Promise(resolve => {
      const s = net.connect(port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => resolve(false))
    })
    if (ok) return true
    await delay(300)
  }
  return false
}

class Bidi {
  #ws; #id = 0; #pending = new Map()
  static async connect(port) {
    for (const path of ['/session', '/']) {
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true })
          ws.addEventListener('error', rej, { once: true })
        })
        const bidi = new Bidi()
        bidi.#ws = ws
        ws.addEventListener('message', e => bidi.#onMessage(e.data))
        return bidi
      } catch { /* try next path */ }
    }
    throw new Error('BiDi へ接続できませんでした')
  }
  #onMessage(raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.id != null && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id)
      this.#pending.delete(msg.id)
      if (msg.type === 'error') reject(new Error(`${msg.error}: ${msg.message}`))
      else resolve(msg.result ?? {})
    }
  }
  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.#pending.has(id)) { this.#pending.delete(id); reject(new Error(`timeout: ${method}`)) }
      }, 60000)
    })
  }
  close() { try { this.#ws.close() } catch { /* noop */ } }
}

const main = async () => {
  const children = []
  const kill = c => {
    if (KEEP) return
    try { process.kill(-c.pid, 'SIGKILL') } catch { try { c.kill('SIGKILL') } catch { /* noop */ } }
  }
  const cleanup = () => { for (const c of children) kill(c) }
  process.on('exit', cleanup)

  // 1) 静的サーバー
  const server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore', detached: true,
  })
  children.push(server)
  if (!await waitPort(PORT)) { fail(`静的サーバーが起動しません (port ${PORT})`); return }
  log(`静的サーバー on :${PORT}`)

  // 2) Firefox
  const profile = `/tmp/opencode/ff-smoke-${process.pid}`
  await fs.rm(profile, { recursive: true, force: true })
  await fs.mkdir(profile, { recursive: true })
  const ffLog = '/tmp/opencode/ff-smoke.log'
  const ffPort = PORT + 1
  const logFd = (await import('node:fs')).openSync(ffLog, 'w')
  const ff = spawn('firefox', [
    '--headless', '--no-remote', '--profile', profile,
    `--remote-debugging-port=${ffPort}`, 'about:blank',
  ], { stdio: ['ignore', logFd, logFd], detached: true })
  children.push(ff)
  if (!await waitPort(ffPort, 45000)) {
    const tail = await fs.readFile(ffLog, 'utf8').catch(() => '(no log)')
    fail(`Firefox が起動しません (port ${ffPort})\n${tail}`)
    return
  }
  log(`Firefox BiDi on :${ffPort}`)
  process.on('exit', () => { fs.rm(profile, { recursive: true, force: true }).catch(() => {}) })

  const bidi = await Bidi.connect(ffPort)
  await bidi.send('session.new', { capabilities: {} })
  const tree = await bidi.send('browsingContext.getTree', {})
  const context = tree.contexts?.[0]?.context
  if (!context) { fail('browsing context が取得できません'); return }

  await bidi.send('browsingContext.setViewport',
    { context, viewport: { width: 1400, height: 1200 } }).catch(() => {})

  const evalJS = async expression => {
    const r = await bidi.send('script.evaluate', {
      expression, target: { context }, awaitPromise: true, resultOwnership: 'none',
    })
    return r.result?.value
  }

  const url = `http://127.0.0.1:${PORT}/index.html?url=./tests/fixtures/sample.epub`
  log('navigate', url)
  await bidi.send('browsingContext.navigate', { context, url, wait: 'complete' })

  const ready = await evalJS(`(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 25000) {
      const v = document.querySelector('foliate-view')
      if (v && v.book && v.renderer && v.renderer.getContents().length) return 'ready'
      await new Promise(r => setTimeout(r, 200))
    }
    return 'timeout'
  })()`)
  if (ready !== 'ready') { fail('書籍の描画が完了しませんでした'); return }
  log('書籍を描画しました')

  const snapshot = () => evalJS(`JSON.stringify((() => {
    const v = document.querySelector('foliate-view')
    const doc = v.renderer.getContents()[0]?.doc
    const cs = doc ? getComputedStyle(doc.body) : null
    return {
      fixed: v.isFixedLayout,
      title: document.getElementById('book-title').textContent,
      writingMode: cs?.writingMode ?? null,
      columnCount: v.renderer.getAttribute('max-column-count'),
      maxInlineSize: v.renderer.getAttribute('max-inline-size'),
      maxBlockSize: v.renderer.getAttribute('max-block-size'),
      columnWidthPx: doc ? getComputedStyle(doc.documentElement).columnWidth : null,
      rootW: doc ? Math.round(doc.documentElement.getBoundingClientRect().width) : null,
      rootH: doc ? Math.round(doc.documentElement.getBoundingClientRect().height) : null,
      pages: v.renderer.pages,
      bodyText: doc ? doc.body.textContent.slice(0, 24) : '',
    }
  })())`)

  // 初期状態: 縦書き
  let s = JSON.parse(await snapshot())
  log('initial', s)
  if (s.fixed) fail('固定レイアウトとして判定されました')
  if (s.writingMode !== 'vertical-rl') fail(`writing-mode が vertical-rl ではない: ${s.writingMode}`)
  if (!(s.pages > 1)) fail(`ページ数が1以下: ${s.pages}`)
  if (!s.bodyText) fail('本文が空です')

  await fs.mkdir(resolve(OUT, '..'), { recursive: true })
  const shot1 = await bidi.send('browsingContext.captureScreenshot', { context })
  await fs.writeFile(OUT, Buffer.from(shot1.data, 'base64'))
  log('screenshot ->', OUT)

  // 横向きへ切替 (再読込パス)
  await evalJS(`document.getElementById('btn-writing').click(); 'ok'`)
  await delay(2500)
  s = JSON.parse(await snapshot())
  log('after horizontal', s)
  if (s.writingMode !== 'horizontal-tb') fail(`横組みへ切り替わらない: ${s.writingMode}`)

  // 単ページへ切替
  await evalJS(`document.getElementById('btn-spread').click(); 'ok'`)
  await delay(1200)
  s = JSON.parse(await snapshot())
  log('after single', s)
  if (s.columnCount !== '1') fail(`単ページ (max-column-count=1) にならない: ${s.columnCount}`)

  // 縦書きに戻す (直前は単ページ)
  await evalJS(`document.getElementById('btn-writing').click(); 'ok'`)
  await delay(2500)
  s = JSON.parse(await snapshot())
  log('back to vertical (single)', s)
  if (s.writingMode !== 'vertical-rl') fail(`縦組みへ戻らない: ${s.writingMode}`)

  // 縦組み単ページの面が縦長 (面幅 < 面高=columnWidth) であること
  const aspect = parseFloat(s.columnWidthPx) / s.rootW
  log(`vertical single page aspect(H/W)=${aspect.toFixed(3)}`)
  if (!(aspect > 1.2))
    fail(`縦組み単ページが縦長でない: H/W=${aspect}`)

  // --- 新機能/不具合修正の検証 ---
  const ui = JSON.parse(await evalJS(`JSON.stringify({
    sliderDir: document.getElementById('slider').dir,
    prevLabel: document.getElementById('btn-prev').getAttribute('aria-label'),
    nextLabel: document.getElementById('btn-next').getAttribute('aria-label'),
    ticks: document.querySelectorAll('#ticks .tick').length,
  })`))
  log('ui', ui)
  if (ui.sliderDir !== 'rtl') fail(`縦組み(右綴じ)でプログレスバーが RTL でない: ${ui.sliderDir}`)
  if (ui.prevLabel !== '次へ' || ui.nextLabel !== '前へ')
    fail(`右綴じの進む/戻る説明が不一致: prev=${ui.prevLabel} next=${ui.nextLabel}`)
  if (!(ui.ticks > 0)) fail('章のチェックポイントが描画されていない')

  // 章ラベル (柱) が入っている
  const head = await evalJS(`(() => {
    const v = document.querySelector('foliate-view')
    return (v.renderer.heads?.[0]?.textContent) || ''
  })()`)
  log('running head:', head)
  if (!head) fail('章ラベル(柱)が描画されていない')

  // 本文端クリックでページ送り (右綴じ: 左端=次)
  await evalJS(`(async () => { await document.querySelector('foliate-view').goTo(0); return 'ok' })()`)
  await delay(1500)
  const click = async (x) => evalJS(`(() => {
    const v = document.querySelector('foliate-view')
    const doc = v.renderer.getContents()[0].doc
    doc.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${x}, clientY: 200 }))
    return 'ok'
  })()`)
  const fracBefore = Number(await evalJS(`document.getElementById('slider').value`))
  await click(5)
  await delay(1000)
  const fracAfter = Number(await evalJS(`document.getElementById('slider').value`))
  log(`edge-click fraction: ${fracBefore} -> ${fracAfter}`)
  if (!(fracAfter > fracBefore)) fail('左端クリックでページが進まない')

  // 挿絵ズーム (クリックでライトボックス表示)
  await evalJS(`(async () => { await document.querySelector('foliate-view').goTo(0); return 'ok' })()`)
  await delay(1500)
  const imgClick = await evalJS(`(() => {
    const v = document.querySelector('foliate-view')
    const img = v.renderer.getContents()[0].doc.querySelector('img')
    if (!img) return 'no-img'
    img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 200 }))
    return 'clicked'
  })()`)
  await delay(400)
  const lb = JSON.parse(await evalJS(`JSON.stringify({
    open: !document.getElementById('lightbox').hidden,
    hasSrc: !!document.getElementById('lightbox-img').getAttribute('src'),
  })`))
  log('illustration zoom', { imgClick, ...lb })
  if (imgClick !== 'clicked') fail(`挿絵が見つからない: ${imgClick}`)
  if (!lb.open || !lb.hasSrc) fail('挿絵クリックでズーム表示されない')
  await evalJS(`document.getElementById('lightbox-close').click(); 'ok'`)

  // 本文カラーテーマ
  await evalJS(`(() => { const s = document.getElementById('content-theme-select'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok' })()`)
  await delay(1200)
  const bodyBg = await evalJS(`(() => {
    const v = document.querySelector('foliate-view')
    return getComputedStyle(v.renderer.getContents()[0].doc.body).backgroundColor
  })()`)
  log('content theme dark bg:', bodyBg)
  if (bodyBg !== 'rgb(18, 20, 23)') fail(`本文ダークテーマが適用されない: ${bodyBg}`)

  // UI カラーテーマ
  await evalJS(`(() => { const s = document.getElementById('ui-theme-select'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok' })()`)
  const uiTheme = await evalJS(`document.documentElement.dataset.uiTheme`)
  log('ui theme:', uiTheme)
  if (uiTheme !== 'dark') fail(`UI ダークテーマが適用されない: ${uiTheme}`)

  // 縦組みで見開きへ切替 → コンテナ幅(=max-block-size)が増えるはず
  const singleBlock = parseFloat(s.maxBlockSize)
  await evalJS(`document.getElementById('btn-spread').click(); 'ok'`)
  await delay(1500)
  s = JSON.parse(await snapshot())
  log('vertical spread', s)
  if (!(parseFloat(s.maxBlockSize) > singleBlock * 1.5))
    fail(`縦組みの見開きで幅が広がらない: single=${singleBlock} spread=${s.maxBlockSize}`)

  bidi.close()
  log(process.exitCode ? 'NG' : 'OK')
}

main().catch(e => { fail(e.stack ?? String(e)) })
