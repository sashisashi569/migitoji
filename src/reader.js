// foliate-view をラップし、組式の適用・見開き/組方向の切替・柱/ノンブルの描画を行う。
import '../vendor/foliate-js/view.js'
import { buildCSS, toRenderOptions, requiresReload } from './kumihan/css.js'
import { isVertical } from './kumihan/spec.js'

export class Reader extends EventTarget {
  #view = null
  #source = null
  #spec = null
  #fixed = false
  #location = null
  #container
  #renderOptions = null
  #verifyTimer = null
  #warned = false

  constructor(container) {
    super()
    this.#container = container
  }

  get view() { return this.#view }
  get isFixedLayout() { return this.#fixed }
  get book() { return this.#view?.book ?? null }
  get spec() { return this.#spec }
  get location() { return this.#location }
  get toc() { return this.#view?.book?.toc ?? [] }
  get metadata() { return this.#view?.book?.metadata ?? {} }

  async open(source, spec) {
    this.#source = source
    if (spec) this.#spec = spec
    this.#destroyView()
    await this.#createAndOpen()
  }

  async #createAndOpen(lastLocation) {
    const view = document.createElement('foliate-view')
    this.#container.append(view)
    this.#view = view

    try {
      await view.open(this.#source)
    } catch (e) {
      view.remove()
      this.#view = null
      throw e
    }

    this.#fixed = !!view.isFixedLayout

    // 書誌情報の不足分を補う (transformTarget が無い形式でも安全に)
    const book = view.book
    book?.transformTarget?.addEventListener('data', ({ detail }) => {
      detail.data = Promise.resolve(detail.data).catch(e => {
        console.warn(`リソースの読み込みに失敗: ${detail.name}`, e)
        return ''
      })
    })

    this.#wire(view)

    if (!this.#fixed && this.#spec) this.#applyToRenderer()

    await view.init({
      lastLocation,
      showTextStart: !lastLocation,
    })

    this.dispatchEvent(new CustomEvent('opened', { detail: { fixed: this.#fixed } }))
  }

  #wire(view) {
    view.addEventListener('relocate', ({ detail }) => {
      this.#location = {
        cfi: detail.cfi,
        fraction: detail.fraction,
        section: detail.section,
        location: detail.location,
        tocItem: detail.tocItem,
        pageItem: detail.pageItem,
      }
      this.#updateMarginals()
      this.#scheduleVerify()
      this.dispatchEvent(new CustomEvent('relocate', { detail: this.#location }))
    })

    view.addEventListener('load', ({ detail }) => {
      detail.doc.addEventListener('keydown', e => this.handleKey(e))
      detail.doc.addEventListener('click', e => this.#onContentClick(e, detail.doc))
      this.dispatchEvent(new CustomEvent('load', { detail }))
    })

    view.addEventListener('external-link', ({ detail }) => {
      this.dispatchEvent(new CustomEvent('external-link', { detail }))
    })
  }

  // 現在の組式を renderer に反映する (再読込不要な変更のみ)。
  #applyToRenderer() {
    const view = this.#view
    if (!view?.renderer || !this.#spec) return
    const renderer = view.renderer
    const opts = toRenderOptions(this.#spec)
    this.#renderOptions = opts
    for (const [name, value] of Object.entries(opts)) renderer.setAttribute(name, value)
    renderer.setStyles?.(buildCSS(this.#spec))
    // gap/margin/max-block-size/max-column-count の変更では自動再描画されないため明示的に
    renderer.render?.()
    this.#scheduleVerify()
  }

  // 自己検証: 実際の段幅が paginator の算出式どおりかを確認し、
  // 食い違えばライブラリ更新で内部仕様が変わった可能性を警告する。
  #scheduleVerify() {
    clearTimeout(this.#verifyTimer)
    this.#verifyTimer = setTimeout(() => this.#verifyLayout(), 350)
  }

  #verifyLayout() {
    if (this.#fixed || !this.#spec || this.#warned) return
    const renderer = this.#view?.renderer
    const doc = renderer?.getContents?.()[0]?.doc
    if (!doc?.documentElement) return
    const cs = doc.defaultView.getComputedStyle(doc.documentElement)
    const colW = parseFloat(cs.columnWidth)
    const rect = doc.documentElement.getBoundingClientRect()
    if (!Number.isFinite(colW) || colW <= 0 || !rect.width || !rect.height) return

    const g = parseFloat(this.#renderOptions?.gap ?? '0') / 100
    const h = Number.isFinite(g) && g < 1 ? g / (1 - g) : 0
    // paginator は 段幅 = size/段数 − gap (size=縦組み:高さ / 横組み:幅, gap=h·size)
    // 縦組み(横長)の段数は 1、横組みは max-column-count。
    const size = isVertical(this.#spec.writingMode) ? rect.height : rect.width
    const n = isVertical(this.#spec.writingMode)
      ? 1
      : Math.max(1, parseFloat(renderer.getAttribute('max-column-count') || '1'))
    const expected = size / n - h * size
    if (expected > 0 && Math.abs(colW - expected) > Math.max(3, expected * 0.06)) {
      this.#warn(`組版の内部計算が想定と一致しません (段幅 ${colW.toFixed(0)}px / 想定 ${expected.toFixed(0)}px)。ライブラリ更新の影響で縦組みの段数制御が無効になっている可能性があります。`)
    }
  }

  #warn(message) {
    if (this.#warned) return
    this.#warned = true
    console.warn('[migitoji]', message)
    this.dispatchEvent(new CustomEvent('layout-warning', { detail: { message } }))
  }

  // 組式を設定する。組方向が変わる場合は柱・しおり位置を保って再読込する。
  async setSpec(spec, { reload = false, preserveLocation = true } = {}) {
    const structural = requiresReload(this.#spec, spec)
    this.#spec = spec
    if (!this.#view) return
    if (this.#fixed) return
    if (structural || reload) {
      const lastLocation = preserveLocation
        ? (this.#location?.cfi ?? (this.#location?.fraction != null ? { fraction: this.#location.fraction } : undefined))
        : undefined
      this.#destroyView()
      await this.#createAndOpen(lastLocation)
    } else {
      this.#applyToRenderer()
    }
  }

  // 現在の組式だけ差し替えて再読込 (組方向が同じでも強制リフレッシュ)
  async refresh() {
    if (!this.#view || this.#fixed) return
    await this.setSpec(this.#spec, { reload: true })
  }

  // 章ラベル / ページ番号を、組式の slot(head/foot)・align・単ページ/見開き別設定に従って描画する。
  #updateMarginals() {
    const renderer = this.#view?.renderer
    if (!renderer?.heads || !this.#spec) return
    const spread = (renderer.heads.length ?? 1) > 1
    const headCfg = this.#spec.runningHead?.[spread ? 'spread' : 'single'] ?? {}
    const numCfg = this.#spec.pageNumber?.[spread ? 'spread' : 'single'] ?? {}
    const { tocItem, pageItem, location } = this.#location ?? {}
    const label = this.#spec.runningHead?.enabled ? (tocItem?.label ?? '') : ''
    const number = this.#spec.pageNumber?.enabled
      ? (pageItem?.label ?? (location ? `${location.current} / ${location.total}` : ''))
      : ''

    for (const el of [...renderer.heads, ...renderer.feet]) el.textContent = ''
    const place = (cfg, text) => {
      if (!text || !cfg) return null
      const arr = cfg.slot === 'foot' ? renderer.feet : renderer.heads
      for (const el of arr) el.textContent = text
      return cfg.slot
    }
    const labelSlot = place(headCfg, label)
    const numSlot = place(numCfg, number)

    // align は head/foot 領域ごとにまとめて適用 (data 属性経由で ::part を CSS 制御)
    const view = this.#view
    const alignOf = (slot, fallback = 'center') =>
      (labelSlot === slot ? headCfg.align
        : numSlot === slot ? numCfg.align : fallback)
    view.dataset.headAlign = alignOf('head')
    view.dataset.footAlign = alignOf('foot')
  }

  // 本文の端クリック/タップでページ送り/戻し (綴り・組方向に従う)。
  #onContentClick(event, doc) {
    if (event.defaultPrevented) return
    const target = event.target
    if (target?.closest?.('a[href]')) return // リンクは foliate が処理
    const win = doc.defaultView
    const sel = win?.getSelection?.()
    if (sel && !sel.isCollapsed) return // 選択中は無効

    // 挿絵ならズーム
    const media = target?.closest?.('img, svg')
    if (media) {
      const rect = media.getBoundingClientRect?.()
      if (rect && (rect.width >= 120 || rect.height >= 120)) {
        this.#zoomIllustration(media)
        return
      }
    }

    const x = event.clientX
    const w = win?.innerWidth ?? 0
    if (!w) return
    if (x < w * 0.25) this.goLeft()
    else if (x > w * 0.75) this.goRight()
  }

  #zoomIllustration(node) {
    let src = ''
    try {
      if (node.localName === 'img') {
        src = node.currentSrc || node.src
      } else if (node.localName === 'svg') {
        const xml = new XMLSerializer().serializeToString(node)
        src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
      }
    } catch (e) { console.warn(e) }
    if (src) this.dispatchEvent(new CustomEvent('illustration', {
      detail: { src, alt: node.getAttribute?.('alt') ?? '' },
    }))
  }

  // 目次の各項目 (章) の位置を fraction として返す (プログレスバーのチェックポイント用)。
  tocFractions() {
    const view = this.#view
    const book = view?.book
    const out = []
    if (!view || !book?.toc?.length) return out
    const fractions = view.getSectionFractions?.() ?? []
    const walk = (items, depth) => {
      for (const item of items) {
        if (!item?.href || this.#isExternal(item.href)) { /* skip */ }
        else {
          try {
            const resolved = view.resolveNavigation(item.href)
            const idx = resolved?.index
            if (idx != null && fractions[idx] != null)
              out.push({ fraction: Math.min(1, fractions[idx] + Number.EPSILON), depth, label: item.label ?? '' })
          } catch { /* skip */ }
        }
        if (item?.subitems?.length && depth < 8) walk(item.subitems, depth + 1)
      }
    }
    walk(book.toc, 0)
    return out
  }

  #isExternal(href) {
    try { return !!this.#view?.book?.isExternal?.(href) } catch { return false }
  }

  #destroyView() {
    if (!this.#view) return
    try { this.#view.close() } catch (e) { console.warn(e) }
    this.#view.remove()
    this.#view = null
  }

  close() {
    this.#destroyView()
    this.#location = null
  }

  get vertical() {
    return isVertical(this.#spec?.writingMode)
  }

  get pageDirection() {
    if (this.vertical) return 'rtl'
    return this.book?.dir === 'rtl' ? 'rtl' : 'ltr'
  }

  async goLeft() {
    if (this.pageDirection === 'rtl') await this.#view?.next()
    else await this.#view?.prev()
  }

  async goRight() {
    if (this.pageDirection === 'rtl') await this.#view?.prev()
    else await this.#view?.next()
  }

  next() { return this.#view?.next() }
  prev() { return this.#view?.prev() }
  goTo(target) { return this.#view?.goTo(target) }
  goToFraction(frac) { return this.#view?.goToFraction(frac) }
  get sectionFractions() { return this.#view?.getSectionFractions?.() ?? [] }

  handleKey(event) {
    if (event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const { key, shiftKey } = event
    const rtl = this.pageDirection === 'rtl'
    const advance = () => this.#view?.next()
    const back = () => this.#view?.prev()
    switch (key) {
      case 'ArrowLeft': event.preventDefault(); rtl ? advance() : back(); break
      case 'ArrowRight': event.preventDefault(); rtl ? back() : advance(); break
      case 'ArrowDown': case 'j': event.preventDefault(); advance(); break
      case 'ArrowUp': case 'k': event.preventDefault(); back(); break
      case 'PageDown': case ' ': event.preventDefault(); shiftKey ? back() : advance(); break
      case 'PageUp': event.preventDefault(); back(); break
      case 'Home': event.preventDefault(); this.#view?.renderer?.firstSection?.(); break
      case 'End': event.preventDefault(); this.#view?.renderer?.lastSection?.(); break
      default: return
    }
  }
}
