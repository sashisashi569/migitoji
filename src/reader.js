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
      this.dispatchEvent(new CustomEvent('relocate', { detail: this.#location }))
    })

    view.addEventListener('load', ({ detail }) => {
      detail.doc.addEventListener('keydown', e => this.handleKey(e))
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
    for (const [name, value] of Object.entries(opts)) renderer.setAttribute(name, value)
    renderer.setStyles?.(buildCSS(this.#spec))
    // gap/margin/max-block-size/max-column-count の変更では自動再描画されないため明示的に
    renderer.render?.()
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

  #updateMarginals() {
    const renderer = this.#view?.renderer
    if (!renderer?.heads) return
    const { tocItem, pageItem, location } = this.#location ?? {}
    const head = tocItem?.label ?? ''
    const foot = pageItem?.label
      ?? (location ? `${location.current} / ${location.total}` : '')
    for (const el of renderer.heads) el.textContent = head
    for (const el of renderer.feet) el.textContent = foot
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
