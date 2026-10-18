#!/usr/bin/env node
// Firefox (WebDriver BiDi) で実際に EPUB を描画し、組方向・見開き切替を検証する smoke test。
// 事前に `npm run dev` 等で静的サーバーを起動しておくか、--serve で自動起動する。
//
// 使い方: node scripts/smoke-browser.mjs [--port 8137] [--out /tmp/smoke.png] [--keep]
//         node scripts/smoke-browser.mjs --mobile            # スマホ相当 (390x844, dpr3) で診断
//         node scripts/smoke-browser.mjs --viewport 412x915 --dpr 2.6
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
const MOBILE = args.includes('--mobile')
const VIEWPORT = argOf('--viewport', MOBILE ? '390x844' : null)
const DPR = Number(argOf('--dpr', MOBILE ? 3 : 0)) || null
const viewportSize = (() => {
  if (!VIEWPORT) return null
  const [w, h] = VIEWPORT.split('x').map(Number)
  return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null
})()
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
      const timer = setTimeout(() => {
        if (this.#pending.has(id)) { this.#pending.delete(id); reject(new Error(`timeout: ${method}`)) }
      }, 60000)
      this.#pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v) },
        reject: e => { clearTimeout(timer); reject(e) },
      })
      this.#ws.send(JSON.stringify({ id, method, params }))
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

  await bidi.send('browsingContext.setViewport', {
    context,
    viewport: viewportSize ?? { width: 1400, height: 1200 },
    ...(DPR ? { devicePixelRatio: DPR } : {}),
  }).catch(e => log('setViewport failed:', e.message))

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

  // ---- スマホ相当レイアウトの診断モード ----
  if (MOBILE) {
    await fs.mkdir(resolve(OUT, '..'), { recursive: true })
    const diag = JSON.parse(await evalJS(`JSON.stringify((() => {
      const v = document.querySelector('foliate-view')
      const view = document.getElementById('view')
      const tb = document.getElementById('toolbar')
      const fb = document.getElementById('progressbar')
      const paper = v.getBoundingClientRect()
      const vr = view.getBoundingClientRect()
      const de = v.renderer.getContents()[0]?.doc?.documentElement
      const der = de ? de.getBoundingClientRect() : null
      const vs = getComputedStyle(view)
      const inView = r => r.left >= vr.left - 1 && r.right <= vr.right + 1 && r.top >= vr.top - 1 && r.bottom <= vr.bottom + 1
      const btns = [...document.querySelectorAll('#toolbar button')].map(b => {
        const r = b.getBoundingClientRect()
        return { id: b.id, left: Math.round(r.left), right: Math.round(r.right), off: r.right > window.innerWidth + 1 || r.left < -1 }
      })
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
        toolbar: { scrollW: tb.scrollWidth, clientW: tb.clientWidth, overflow: tb.scrollWidth > tb.clientWidth + 1 },
        footer: { scrollW: fb.scrollWidth, clientW: fb.clientWidth, overflow: fb.scrollWidth > fb.clientWidth + 1 },
        view: { w: Math.round(vr.width), h: Math.round(vr.height) },
        paper: { w: Math.round(paper.width), h: Math.round(paper.height), aspect: +(paper.height / paper.width).toFixed(3), inView: inView(paper) },
        paperVar: { w: vs.getPropertyValue('--paper-w').trim(), h: vs.getPropertyValue('--paper-h').trim() },
        paperScale: Number(vs.getPropertyValue('--paper-scale').trim() || '1'),
        content: der ? { w: Math.round(der.width), h: Math.round(der.height) } : null,
        contentMatchesAttrs: (() => {
          if (!de) return null
          const vert = getComputedStyle(de).writingMode.startsWith('vertical')
          if (!vert) return null
          const mi = parseFloat(v.renderer.getAttribute('max-inline-size'))
          const mb = parseFloat(v.renderer.getAttribute('max-block-size'))
          return Math.abs(der.width - mb) < 2 && Math.abs(der.height - mi) < 2
        })(),
        headings: (() => {
          if (!de) return null
          const doc = de.ownerDocument
          const bodyCs = getComputedStyle(doc.body)
          const advance = parseFloat(bodyCs.lineHeight)
          return [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 6).map(h => {
            const cs = getComputedStyle(h)
            const box = parseFloat(cs.lineHeight)
            return {
              tag: h.localName,
              fontSize: cs.fontSize,
              lineHeight: cs.lineHeight,
              margin: cs.marginBlockStart,
              lines: +(box / advance).toFixed(3),
            }
          })
        })(),
        lineCharCounts: (() => {
          if (!de) return null
          const doc = de.ownerDocument
          const vert = getComputedStyle(de).writingMode.startsWith('vertical')
          const counts = new Map()
          const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
          const range = doc.createRange()
          let node, n = 0
          while ((node = walker.nextNode()) && n < 4000) {
            const text = node.nodeValue
            if (!text) continue
            for (let i = 0; i < text.length && n < 4000; i++) {
              if (!text[i].trim()) continue
              range.setStart(node, i); range.setEnd(node, i + 1)
              const r = range.getBoundingClientRect()
              if (!r.width && !r.height) continue
              const key = Math.round((vert ? r.left : r.top) / 2) * 2
              counts.set(key, (counts.get(key) || 0) + 1)
              n++
            }
          }
          const arr = [...counts.values()].sort((a, b) => b - a)
          if (!arr.length) return null
          return { lines: arr.length, max: arr[0], min: arr[arr.length - 1], top: arr.slice(0, 6) }
        })(),
        renderer: {
          maxInlineSize: v.renderer.getAttribute('max-inline-size'),
          maxBlockSize: v.renderer.getAttribute('max-block-size'),
          columnCount: v.renderer.getAttribute('max-column-count'),
          pages: v.renderer.pages,
        },
        buttonsOffscreen: btns.filter(b => b.off),
        writingMode: de ? getComputedStyle(de).writingMode : null,
        hostStyle: (() => {
          const cs = getComputedStyle(v)
          return { width: cs.width, maxWidth: cs.maxWidth, height: cs.height, maxHeight: cs.maxHeight, display: cs.display, position: cs.position, transform: cs.transform }
        })(),
        viewStyle: (() => {
          const cs = getComputedStyle(view)
          return { display: cs.display, width: cs.width, overflow: cs.overflow }
        })(),
      }
    })())`))
    log('mobile diagnostics', JSON.stringify(diag, null, 2))

    const shot = await bidi.send('browsingContext.captureScreenshot', { context })
    await fs.writeFile(OUT, Buffer.from(shot.data, 'base64'))
    log('screenshot ->', OUT)

    if (diag.doc.scrollW > diag.viewport.w + 1)
      fail(`横スクロールが発生: scrollW=${diag.doc.scrollW} > viewport=${diag.viewport.w}`)
    if (diag.toolbar.overflow)
      fail(`ツールバーが横に溢れる: scrollW=${diag.toolbar.scrollW} > clientW=${diag.toolbar.clientW}`)
    if (diag.buttonsOffscreen.length)
      fail(`画面外のボタン: ${diag.buttonsOffscreen.map(b => b.id).join(',')}`)
    if (!diag.paper.inView)
      fail(`紙が閲覧領域からはみ出す: paper=${diag.paper.w}x${diag.paper.h} view=${diag.view.w}x${diag.view.h}`)
    if (!(diag.renderer.pages > 1))
      fail(`ページ数が1以下: ${diag.renderer.pages}`)

    // 紙に transform を使わず、本文の実寸が組式属性どおりであること。
    // (transform: scale は paginator の getBoundingClientRect 計測を狂わせ、
    //  小さい画面で開いたときにテキストが崩れる)
    if (diag.hostStyle.transform !== 'none')
      fail(`紙に transform が残っている: ${diag.hostStyle.transform}`)
    if (diag.contentMatchesAttrs === false)
      fail(`本文の実寸が組式属性と一致しない (transform/クランプの疑い): content=${JSON.stringify(diag.content)} renderer=${diag.renderer.maxBlockSize}x${diag.renderer.maxInlineSize}`)

    // 見出しが行グリッドに乗っていること (行ボックスが行送りの整数倍・余白 0)
    for (const h of diag.headings ?? []) {
      if (Math.abs(h.lines - Math.round(h.lines)) > 0.02)
        fail(`見出しが行グリッドに乗っていない: ${h.tag} box=${h.lines}行`)
      if (h.margin !== '0px')
        fail(`見出しに余白が残っている: ${h.tag} margin=${h.margin}`)
    }

    // 文字サイズを変えても「一面あたりの字数・行数」が変わらないこと
    const pageMetrics = () => evalJS(`JSON.stringify((() => {
      const v = document.querySelector('foliate-view')
      const doc = v.renderer.getContents()[0].doc
      const cs = doc.defaultView.getComputedStyle(doc.body)
      const fs = parseFloat(cs.fontSize)
      const ls = parseFloat(cs.letterSpacing) || 0
      const lh = parseFloat(cs.lineHeight) || fs * 1.7
      const inlinePx = parseFloat(v.renderer.getAttribute('max-inline-size'))
      const blockPx = parseFloat(v.renderer.getAttribute('max-block-size'))
      return { fs, ls, lh, inlinePx, blockPx, chars: inlinePx / (fs + ls), lines: blockPx / lh }
    })())`)
    const setRange = (path, val) => evalJS(`(() => {
      const i = document.querySelector('input[type=range][data-path="${path}"]')
      if (!i) return 'no-input'
      i.value = ${val}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    })()`)
    const m0 = JSON.parse(await pageMetrics())
    await setRange('font.size', Math.max(8, m0.fs - 4)); await delay(1500)
    const m1 = JSON.parse(await pageMetrics())
    log('font-size invariance', { before: { fs: m0.fs, chars: +m0.chars.toFixed(1), lines: +m0.lines.toFixed(1) }, after: { fs: m1.fs, chars: +m1.chars.toFixed(1), lines: +m1.lines.toFixed(1) } })
    const rel = (a, b) => Math.abs(a - b) / Math.max(a, b)
    if (rel(m0.chars, m1.chars) > 0.02)
      fail(`文字サイズ変更で字詰めが変わる: ${m0.chars.toFixed(1)} -> ${m1.chars.toFixed(1)}`)
    if (rel(m0.lines, m1.lines) > 0.02)
      fail(`文字サイズ変更で行数が変わる: ${m0.lines.toFixed(1)} -> ${m1.lines.toFixed(1)}`)

    // リサイズ（回転・ウィンドウ変更相当）でも再レイアウトされ、収まったままであること
    const newW = Math.max(viewportSize?.width ?? 390, 360) + 80
    await bidi.send('browsingContext.setViewport', {
      context,
      viewport: { width: newW, height: viewportSize?.height ?? 700 },
      ...(DPR ? { devicePixelRatio: DPR } : {}),
    }).catch(e => log('setViewport failed:', e.message))
    await delay(1200)
    const resized = JSON.parse(await evalJS(`JSON.stringify((() => {
      const v = document.querySelector('foliate-view')
      const view = document.getElementById('view')
      const r = v.getBoundingClientRect(), vr = view.getBoundingClientRect()
      const doc = v.renderer.getContents()[0].doc
      const cs = doc.defaultView.getComputedStyle(doc.body)
      const fs = parseFloat(cs.fontSize), ls = parseFloat(cs.letterSpacing) || 0
      const inlinePx = parseFloat(v.renderer.getAttribute('max-inline-size'))
      return {
        w: Math.round(r.width), h: Math.round(r.height), vw: Math.round(vr.width), vh: Math.round(vr.height),
        inView: r.left >= vr.left - 1 && r.right <= vr.right + 1 && r.top >= vr.top - 1 && r.bottom <= vr.bottom + 1,
        transform: getComputedStyle(v).transform,
        chars: inlinePx / (fs + ls),
      }
    })())`))
    log('after resize', { w: resized.w, h: resized.h, vw: resized.vw, vh: resized.vh, inView: resized.inView, transform: resized.transform, chars: +resized.chars.toFixed(1) })
    if (!resized.inView) fail(`リサイズ後に紙がはみ出す: ${JSON.stringify(resized)}`)
    if (resized.transform !== 'none') fail(`リサイズ後に transform が付いた: ${resized.transform}`)
    if (rel(m0.chars, resized.chars) > 0.03)
      fail(`リサイズで字詰めが変わる: ${m0.chars.toFixed(1)} -> ${resized.chars.toFixed(1)}`)

    // ページ送り/戻し (main#view 基準の左右25%)
    await evalJS(`(async () => { await document.querySelector('foliate-view').goTo(0); return 'ok' })()`)
    await delay(1200)
    const frac = () => evalJS(`document.getElementById('slider').value`).then(Number)
    const clickRel = rel => evalJS(`(() => {
      const v = document.getElementById('view')
      const r = v.getBoundingClientRect()
      v.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * ${rel}, clientY: r.top + r.height / 2 }))
      return 'ok'
    })()`)
    const f0 = await frac()
    await clickRel(0.1); await delay(900)
    const f1 = await frac()
    await clickRel(0.9); await delay(900)
    const f2 = await frac()
    log(`mobile click zones: ${f0} -> ${f1} (left25%) -> ${f2} (right25%)`)
    if (!(f1 > f0)) fail('モバイル: 左25%クリックでページが進まない')
    if (!(f2 < f1)) fail('モバイル: 右25%クリックでページが戻らない')

    // 設定パネルが画面内に収まる
    await evalJS(`document.getElementById('btn-settings').click(); 'ok'`)
    await delay(500)
    const panel = JSON.parse(await evalJS(`JSON.stringify((() => {
      const r = document.getElementById('settings').getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), vw: window.innerWidth }
    })())`))
    log('mobile settings panel', panel)
    if (panel.left < -1 || panel.right > panel.vw + 1)
      fail(`設定パネルが画面外: ${JSON.stringify(panel)}`)

    bidi.close()
    log(process.exitCode ? 'NG' : 'OK')
    return
  }

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

  // main#view 基準の左右25%クリックでページ送り/戻し (右綴じ: 左=次 / 右=前)
  await evalJS(`(async () => { await document.querySelector('foliate-view').goTo(0); return 'ok' })()`)
  await delay(1500)
  const clickRel = rel => evalJS(`(() => {
    const v = document.getElementById('view')
    const r = v.getBoundingClientRect()
    v.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * ${rel}, clientY: r.top + r.height / 2 }))
    return 'ok'
  })()`)
  const frac = () => evalJS(`document.getElementById('slider').value`).then(Number)
  const f0 = await frac()
  await clickRel(0.1); await delay(1000)
  const f1 = await frac()
  await clickRel(0.9); await delay(1000)
  const f2 = await frac()
  await clickRel(0.5); await delay(800)
  const f3 = await frac()
  log(`view-zone fractions: ${f0} -> ${f1} (left25%) -> ${f2} (right25%) -> ${f3} (center)`)
  if (!(f1 > f0)) fail('左25%(#view基準)クリックでページが進まない')
  if (!(f2 < f1)) fail('右25%(#view基準)クリックでページが戻らない')
  if (f3 !== f2) fail('中央(#view基準)クリックでページが動いてしまう')

  // div#background (paper 面, target は foliate-view に再ターゲット) のクリックも同基準
  const clickPaper = rel => evalJS(`(() => {
    const v = document.getElementById('view')
    const pv = v.querySelector('foliate-view')
    const r = v.getBoundingClientRect()
    pv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * ${rel}, clientY: r.top + r.height / 2 }))
    return 'ok'
  })()`)
  const g0 = await frac()
  await clickPaper(0.12); await delay(1000)
  const g1 = await frac()
  await clickPaper(0.88); await delay(1000)
  const g2 = await frac()
  log(`paper(#background) fractions: ${g0} -> ${g1} (left25%) -> ${g2} (right25%)`)
  if (!(g1 > g0)) fail('#background 左25%クリックでページが進まない')
  if (!(g2 < g1)) fail('#background 右25%クリックでページが戻らない')

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
  const lb = JSON.parse(await evalJS(`JSON.stringify((() => {
    const img = document.getElementById('lightbox-img')
    const r = img.getBoundingClientRect()
    return {
      open: !document.getElementById('lightbox').hidden,
      hasSrc: !!img.getAttribute('src'),
      w: Math.round(r.width), h: Math.round(r.height),
      vw: window.innerWidth, vh: window.innerHeight,
    }
  })())`))
  log('illustration zoom', { imgClick, ...lb })
  if (imgClick !== 'clicked') fail(`挿絵が見つからない: ${imgClick}`)
  if (!lb.open || !lb.hasSrc) fail('挿絵クリックでズーム表示されない')
  // ブラウザ表示領域に合わせて拡大されていること (元は 300x200)
  if (!(Math.max(lb.w, lb.h) >= Math.min(lb.vw, lb.vh) * 0.8))
    fail(`挿絵がブラウザ表示サイズに拡大されていない: img=${lb.w}x${lb.h} viewport=${lb.vw}x${lb.vh}`)
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

  // 余白を増やしても本文(組式サイズ)が潰れず、紙が外側に広がること
  const measurePaper = () => evalJS(`JSON.stringify((() => {
    const v = document.querySelector('foliate-view')
    const de = v.renderer.getContents()[0].doc.documentElement.getBoundingClientRect()
    const fv = document.querySelector('#view > foliate-view').getBoundingClientRect()
    return { rw: Math.round(de.width), rh: Math.round(de.height), pw: Math.round(fv.width), ph: Math.round(fv.height) }
  })())`)
  const setRange = (path, val) => evalJS(`(() => {
    const i = document.querySelector('input[type=range][data-path="${path}"]')
    if (!i) return 'no-input'
    i.value = ${val}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`)
  await setRange('page.inset', 0); await delay(1200)
  const p0 = JSON.parse(await measurePaper())
  await setRange('page.inset', 64); await delay(1200)
  const p1 = JSON.parse(await measurePaper())
  log('paper inset 0 ->', p0)
  log('paper inset 64 ->', p1)
  if (Math.abs(p0.rw - p1.rw) > 2 || Math.abs(p0.rh - p1.rh) > 2)
    fail(`余白で本文が潰れている: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`)
  if (!(p1.pw >= p0.pw + 100 && p1.ph >= p0.ph + 100))
    fail(`余白で紙が外側に広がらない: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`)
  await setRange('page.inset', 28); await delay(1000)

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

main().catch(e => { fail(e.stack ?? String(e)) }).finally(() => {
  // WebSocket のクローズ待ち等でハングしないよう、明示的に終了する。
  // ('exit' ハンドラで子プロセスは片付く)
  setTimeout(() => process.exit(process.exitCode ?? 0), 100)
})
