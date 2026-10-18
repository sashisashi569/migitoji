// UI シェルと設定パネルを構築し、Reader と組式を結びつける。
import { Reader } from '../reader.js'
import {
  normalizeSpec, defaultSpec, isVertical, mergeSpec,
} from '../kumihan/spec.js'
import { PRESETS, getPreset } from '../kumihan/presets.js'
import {
  parseKumihan, serializeSpec, loadStoredSpec, storeSpec, downloadSpec, readFileAsText,
} from '../kumihan/io.js'

const $ = sel => document.querySelector(sel)

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (v === true) node.setAttribute(k, '')
    else if (v === false || v == null) continue
    else node.setAttribute(k, v)
  }
  for (const child of children.flat()) {
    if (child == null) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

const setPath = (path, value) => {
  const keys = path.split('.')
  const root = {}
  let cur = root
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value
    else cur = (cur[k] = {})
  })
  return root
}

const getPath = (obj, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

const formatLanguageMap = x => {
  if (!x) return ''
  if (typeof x === 'string') return x
  const keys = Object.keys(x)
  return keys.length ? x[keys[0]] : ''
}

const formatContributor = c => {
  const one = x => typeof x === 'string' ? x : formatLanguageMap(x?.name)
  if (Array.isArray(c)) return c.map(one).join('、')
  return one(c)
}

const percentFormat = new Intl.NumberFormat('ja', { style: 'percent', maximumFractionDigits: 1 })

const WRITING_OPTIONS = [
  { value: 'vertical-rl', label: '縦書き' },
  { value: 'horizontal-tb', label: '横書き' },
]
const SPREAD_OPTIONS = [
  { value: 'auto', label: '自動' },
  { value: 'spread', label: '見開き' },
  { value: 'single', label: '単ページ' },
]
const ALIGN_OPTIONS = [
  { value: 'justify', label: '両端揃え' },
  { value: 'start', label: '行頭揃え' },
  { value: 'center', label: '中央' },
]
const FAMILY_OPTIONS = [
  { value: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", label: '明朝体' },
  { value: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif", label: 'ゴシック体' },
  { value: "Georgia, 'Times New Roman', 'Noto Serif', serif", label: '欧文セリフ' },
  { value: "system-ui, -apple-system, 'Noto Sans', sans-serif", label: '欧文サンセリフ' },
]
const RANGES = [
  { path: 'font.size', label: '文字サイズ', min: 8, max: 32, step: 0.5, unit: 'px' },
  { path: 'font.lineHeight', label: '行送り', min: 1.2, max: 2.4, step: 0.05, unit: '' },
  { path: 'font.letterSpacing', label: '字間', min: -0.05, max: 0.2, step: 0.005, unit: 'em' },
  { path: 'paragraph.indent', label: '字下げ', min: 0, max: 3, step: 0.25, unit: '字' },
  { path: 'page.margin', label: '柱/ノンブル帯', min: 0, max: 200, step: 2, unit: 'px' },
  { path: 'page.gap', label: '段間', min: 0, max: 24, step: 0.5, unit: '%' },
  { path: 'page.charsPerLine', label: '字詰め', min: 8, max: 80, step: 1, unit: '字' },
  { path: 'page.linesPerPage', label: '行数', min: 4, max: 48, step: 1, unit: '行' },
  { path: 'page.inset', label: '余白(外周)', min: 0, max: 120, step: 2, unit: 'px' },
  { path: 'page.frame.width', label: '外枠の太さ', min: 0, max: 16, step: 1, unit: 'px' },
  { path: 'page.frame.radius', label: '外枠の角', min: 0, max: 40, step: 1, unit: 'px' },
]

const UI_THEME_OPTIONS = [
  { value: 'auto', label: '自動（ブラウザ準拠）' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]
const CONTENT_THEME_OPTIONS = [
  { value: 'auto', label: '自動（書籍のまま）' },
  { value: 'light', label: 'ライト' },
  { value: 'sepia', label: 'セピア' },
  { value: 'dark', label: 'ダーク' },
  { value: 'custom', label: 'カスタム' },
]
const SLOT_OPTIONS = [
  { value: 'head', label: '上（柱）' },
  { value: 'foot', label: '下（脚）' },
]
const HEAD_ALIGN_OPTIONS = [
  { value: 'start', label: '先頭' },
  { value: 'center', label: '中央' },
  { value: 'end', label: '末尾' },
]
const FRAME_STYLE_OPTIONS = [
  { value: 'solid', label: '実線' },
  { value: 'double', label: '二重線' },
  { value: 'dashed', label: '破線' },
  { value: 'dotted', label: '点線' },
]

const UI_THEME_KEY = 'migitoji.ui.v1'

export class App {
  #reader = null
  #spec = null
  #controls = []
  #applyTimer = null
  #toastTimer = null
  #presetSelect = null
  #familySelect = null
  #alignSelect = null
  #contentThemeSelect = null
  #uiThemeSelect = null
  #frameEnabled = null
  #frameStyle = null
  #frameColor = null
  #jsonArea = null
  #jsonNotice = null
  #uiTheme = 'auto'

  constructor() {
    this.els = {
      view: $('#view'),
      title: $('#book-title'),
      slider: $('#slider'),
      ticks: $('#ticks'),
      progressLabel: $('#progress-label'),
      toc: $('#toc'),
      sidebar: $('#sidebar'),
      settings: $('#settings'),
      settingsBody: $('#settings-body'),
      scrim: $('#scrim'),
      dropTarget: $('#drop-target'),
      toast: $('#toast'),
      fileInput: $('#file-input'),
      lightbox: $('#lightbox'),
      lightboxImg: $('#lightbox-img'),
      progressbar: $('#progressbar'),
    }
  }

  init() {
    this.#spec = normalizeSpec(loadStoredSpec() ?? getPreset('bunko-vertical') ?? defaultSpec()).spec
    this.#initUiTheme()
    this.#buildSettings()
    this.#wireChrome()
    this.#wireDropTarget()
    this.#syncControls()
    this.#syncJSON()
    this.#applyFrame()

    const params = new URLSearchParams(location.search)
    const url = params.get('url')
    if (url) this.open(url).catch(e => this.#error(e))
  }

  // ---------- 公開 ----------
  async open(source) {
    if (!this.#reader) {
      this.#reader = new Reader(this.els.view)
      this.#reader.addEventListener('relocate', ({ detail }) => this.#onRelocate(detail))
      this.#reader.addEventListener('load', () => this.#ensureProgressVisibility())
      this.#reader.addEventListener('layout-warning', ({ detail }) => this.#toast(detail.message, 'error'))
      this.#reader.addEventListener('illustration', ({ detail }) => this.#showLightbox(detail.src, detail.alt))
    }
    await this.#reader.open(source, this.#spec)
    this.#onOpened()
  }

  // ---------- 設定パネル構築 ----------
  #buildSettings() {
    const body = this.els.settingsBody
    body.replaceChildren()

    body.append(this.#sectionPreset())
    body.append(this.#sectionLayout())
    body.append(this.#sectionType())
    body.append(this.#sectionPage())
    body.append(this.#sectionFrame())
    body.append(this.#sectionMarginals())
    body.append(this.#sectionTheme())
    body.append(this.#sectionJSON())
  }

  #sectionTheme() {
    const ui = el('select', { id: 'ui-theme-select' })
    this.#uiThemeSelect = ui
    for (const o of UI_THEME_OPTIONS) ui.append(el('option', { value: o.value }, o.label))
    ui.addEventListener('change', () => this.#setUiTheme(ui.value))

    const content = el('select', { id: 'content-theme-select' })
    this.#contentThemeSelect = content
    for (const o of CONTENT_THEME_OPTIONS) content.append(el('option', { value: o.value }, o.label))
    content.addEventListener('change', () => this.#commit(setPath('colors.theme', content.value), { immediate: true }))

    return el('div', { class: 'section' },
      el('h2', {}, 'カラーテーマ'),
      el('div', { class: 'field' }, el('label', { for: 'ui-theme-select' }, 'UI'),
        el('div', { class: 'control' }, ui)),
      el('div', { class: 'field' }, el('label', { for: 'content-theme-select' }, '本文'),
        el('div', { class: 'control' }, content)),
      el('p', { class: 'notice' }, 'UI テーマはコンテンツ以外（ツールバー・パネル等）に適用されます。「自動」ではブラウザのカラーテーマを尊重します。'),
    )
  }

  #sectionFrame() {
    const section = el('div', { class: 'section' }, el('h2', {}, '余白・外枠'))

    const enabled = el('input', { type: 'checkbox', id: 'frame-enabled' })
    this.#frameEnabled = enabled
    enabled.addEventListener('change', () => this.#commit(setPath('page.frame.enabled', enabled.checked), { immediate: true }))
    section.append(el('div', { class: 'field' },
      el('label', {}, '外枠'),
      el('div', { class: 'control' },
        el('label', { class: 'check', for: 'frame-enabled' }, enabled, '表示する'))))

    for (const r of RANGES.filter(r => r.path === 'page.inset' || r.path.startsWith('page.frame.')))
      section.append(this.#rangeField(r))

    const style = el('select', { id: 'frame-style' })
    for (const o of FRAME_STYLE_OPTIONS) style.append(el('option', { value: o.value }, o.label))
    style.addEventListener('change', () => this.#commit(setPath('page.frame.style', style.value), { immediate: true }))
    this.#frameStyle = style
    section.append(el('div', { class: 'field' }, el('label', { for: 'frame-style' }, '線種'),
      el('div', { class: 'control' }, style)))

    const color = el('input', { type: 'color', id: 'frame-color' })
    color.addEventListener('input', () => this.#commit(setPath('page.frame.color', color.value), { immediate: false }))
    color.addEventListener('change', () => this.#flush())
    this.#frameColor = color
    section.append(el('div', { class: 'field' }, el('label', { for: 'frame-color' }, '色'),
      el('div', { class: 'control' }, color)))
    return section
  }

  #sectionMarginals() {
    const section = el('div', { class: 'section' },
      el('h2', {}, '柱・ノンブル'),
      el('p', { class: 'notice' }, '現在の章ラベルとページ番号の位置を、単ページ / 見開き で別々に指定できます。'),
    )
    const add = (title, base) => {
      section.append(el('h3', { class: 'sub' }, title))
      for (const mode of [['single', '単ページ'], ['spread', '見開き']]) {
        const [key, label] = mode
        section.append(el('div', { class: 'field' }, el('label', {}, label),
          el('div', { class: 'control' },
            this.#inlineSelect(`${base}.${key}.slot`, SLOT_OPTIONS),
            this.#inlineSelect(`${base}.${key}.align`, HEAD_ALIGN_OPTIONS))))
      }
    }
    add('章ラベル', 'runningHead')
    add('ページ番号', 'pageNumber')
    return section
  }

  #inlineSelect(path, options) {
    const select = el('select', { class: 'mini' })
    for (const o of options) select.append(el('option', { value: o.value }, o.label))
    select.addEventListener('change', () => this.#commit(setPath(path, select.value), { immediate: true }))
    this.#controls.push({ type: 'select', path, input: select })
    return select
  }

  #sectionPreset() {
    const select = el('select', { id: 'preset-select' })
    this.#presetSelect = select
    for (const p of PRESETS) select.append(el('option', { value: p.id }, p.name))
    select.append(el('option', { value: '__custom__' }, 'カスタム'))
    select.addEventListener('change', () => {
      const p = getPreset(select.value)
      if (p) this.#setSpec(normalizeSpec(p).spec, { immediate: true })
    })
    const reset = el('button', { class: 'btn', type: 'button' }, 'プリセットへ戻す')
    reset.addEventListener('click', () => {
      const p = getPreset(this.#spec.id) ?? getPreset('bunko-vertical')
      if (p) this.#setSpec(normalizeSpec(p).spec, { immediate: true })
    })
    return el('div', { class: 'section' },
      el('h2', {}, '組式プリセット'),
      el('div', { class: 'field' }, el('label', { for: 'preset-select' }, 'プリセット'),
        el('div', { class: 'control' }, select)),
      el('div', { class: 'btn-row' }, reset),
      el('p', { class: 'notice' }, '日本の出版社・判型の組版を参考にした内蔵プリセットです。数値は参考値であり、各社の公式仕様ではありません。'),
    )
  }

  #sectionLayout() {
    return el('div', { class: 'section' },
      el('h2', {}, '組方向・見開き'),
      this.#radioField('組方向', 'writingMode', WRITING_OPTIONS),
      this.#radioField('見開き', 'page.spread', SPREAD_OPTIONS),
    )
  }

  #sectionType() {
    const family = el('select', { id: 'family-select' })
    this.#familySelect = family
    for (const o of FAMILY_OPTIONS) family.append(el('option', { value: o.value }, o.label))
    family.addEventListener('change', () => this.#commit(setPath('font.family', family.value), { immediate: true }))

    const align = el('select', { id: 'align-select' })
    this.#alignSelect = align
    for (const o of ALIGN_OPTIONS) align.append(el('option', { value: o.value }, o.label))
    align.addEventListener('change', () => this.#commit(setPath('paragraph.align', align.value), { immediate: true }))

    const section = el('div', { class: 'section' },
      el('h2', {}, '書体・本文'),
      el('div', { class: 'field' }, el('label', { for: 'family-select' }, '書体'),
        el('div', { class: 'control' }, family)),
      el('div', { class: 'field' }, el('label', { for: 'align-select' }, '行揃え'),
        el('div', { class: 'control' }, align)),
    )
    for (const r of RANGES.filter(r => r.path.startsWith('font.') || r.path === 'paragraph.indent'))
      section.append(this.#rangeField(r))
    this.#familySelect = family
    this.#alignSelect = align
    return section
  }

  #sectionPage() {
    const section = el('div', { class: 'section' },
      el('h2', {}, 'ページ・組版'),
    )
    for (const r of RANGES.filter(r => r.path.startsWith('page.')))
      section.append(this.#rangeField(r))
    section.append(el('p', { class: 'notice' },
      '字詰め＝1行の字数（max-inline-size）、行数＝1面の行数（max-block-size）として、横組み・縦組みとも独立に組版されます。見開き/単ページはこの行数方向の幅で切り替わります。画面が小さい場合は表示できる字数・行数までに制限されます。'))
    return section
  }

  #sectionJSON() {
    const textarea = el('textarea', { id: 'json', spellcheck: 'false' })
    this.#jsonArea = textarea
    const notice = el('p', { class: 'notice', id: 'json-notice' })
    this.#jsonNotice = notice

    const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true })
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      fileInput.value = ''
      try {
        const text = await readFileAsText(file)
        this.#importJSON(text)
      } catch (e) { this.#error(e) }
    })

    const importBtn = el('button', { class: 'btn', type: 'button' }, 'JSONファイルを読み込む')
    importBtn.addEventListener('click', () => fileInput.click())
    const applyBtn = el('button', { class: 'btn primary', type: 'button' }, '適用')
    applyBtn.addEventListener('click', () => {
      try { this.#importJSON(textarea.value) } catch (e) { this.#error(e) }
    })
    const exportBtn = el('button', { class: 'btn', type: 'button' }, '書き出す')
    exportBtn.addEventListener('click', () => downloadSpec(this.#spec))
    const copyBtn = el('button', { class: 'btn', type: 'button' }, 'コピー')
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(serializeSpec(this.#spec)); this.#toast('クリップボードへコピーしました') }
      catch { this.#toast('コピーに失敗しました。手動で選択してください', 'error') }
    })
    const resetBtn = el('button', { class: 'btn', type: 'button' }, '初期化')
    resetBtn.addEventListener('click', () => {
      this.#setSpec(normalizeSpec(defaultSpec()).spec, { immediate: true })
      this.#toast('組式を既定値に戻しました')
    })

    return el('div', { class: 'section' },
      el('h2', {}, '組式 JSON'),
      el('div', { class: 'field', style: 'display:block' }, textarea),
      el('div', { class: 'btn-row' }, importBtn, applyBtn, exportBtn, copyBtn, resetBtn),
      fileInput,
      notice,
      el('p', { class: 'notice' }, '任意の JSON を貼り付けて「適用」すると、その組式で組版し直します。「preset」にプリセット ID を書くと差分適用できます。'),
    )
  }

  #radioField(label, path, options) {
    const row = el('div', { class: 'radio-row' })
    const name = 'radio-' + path.replace(/\./g, '-')
    for (const o of options) {
      const input = el('input', { type: 'radio', name, value: o.value })
      input.addEventListener('change', () => {
        if (input.checked) this.#commit(setPath(path, o.value), { immediate: true })
      })
      row.append(el('label', {}, input, o.label))
      this.#controls.push({ type: 'radio', path, value: o.value, input, name })
    }
    return el('div', { class: 'field' }, el('label', {}, label), el('div', { class: 'control' }, row))
  }

  #rangeField({ path, label, min, max, step, unit }) {
    const input = el('input', { type: 'range', min, max, step, value: 0 })
    const output = el('output')
    const update = () => {
      const v = Number(input.value)
      output.textContent = `${v}${unit}`
      this.#commit(setPath(path, v), { immediate: false })
    }
    input.addEventListener('input', update)
    input.addEventListener('change', () => this.#flush())
    this.#controls.push({ type: 'range', path, input, output, unit })
    return el('div', { class: 'field' },
      el('label', {}, label),
      el('div', { class: 'control' }, input),
      output)
  }

  // ---------- 状態更新 ----------
  #commit(patch, { immediate }) {
    const merged = mergeSpec(this.#spec, patch)
    const { spec, warnings } = normalizeSpec(merged)
    this.#spec = spec
    this.#syncControls()
    if (warnings.length) this.#setNotice(warnings.join(' / '), 'warn')
    if (immediate) this.#flush()
    else this.#schedule()
  }

  #setSpec(spec, { immediate } = {}) {
    this.#spec = spec
    this.#syncControls()
    this.#syncJSON()
    if (immediate !== false) this.#flush()
  }

  #schedule() {
    clearTimeout(this.#applyTimer)
    this.#applyTimer = setTimeout(() => this.#flush(), 140)
  }

  #flush() {
    clearTimeout(this.#applyTimer)
    this.#applyTimer = null
    storeSpec(this.#spec)
    this.#applyFrame()
    if (this.#reader?.view) {
      this.#reader.setSpec(this.#spec)
        .then(() => { this.#updateDirection(); this.#buildTicks() })
        .catch(e => this.#error(e))
    }
    this.#syncJSON()
  }

  #syncControls() {
    const spec = this.#spec
    for (const c of this.#controls) {
      if (c.type === 'range') {
        const v = getPath(spec, c.path)
        if (v != null && document.activeElement !== c.input) {
          c.input.value = String(v)
          c.output.textContent = `${v}${c.unit}`
        }
      } else if (c.type === 'radio') {
        const v = getPath(spec, c.path)
        c.input.checked = String(v) === String(c.value)
      } else if (c.type === 'select') {
        const v = getPath(spec, c.path)
        if (v != null) c.input.value = String(v)
      }
    }
    if (this.#contentThemeSelect) this.#contentThemeSelect.value = spec.colors.theme
    if (this.#uiThemeSelect) this.#uiThemeSelect.value = this.#uiTheme
    if (this.#frameEnabled) this.#frameEnabled.checked = !!spec.page.frame.enabled
    if (this.#frameStyle) this.#frameStyle.value = spec.page.frame.style
    if (this.#frameColor) this.#frameColor.value = spec.page.frame.color || '#888888'
    if (this.#presetSelect) {
      const known = PRESETS.some(p => p.id === spec.id)
      this.#presetSelect.value = known ? spec.id : '__custom__'
    }
    if (this.#familySelect) {
      const opts = [...this.#familySelect.options].map(o => o.value)
      this.#familySelect.value = opts.includes(spec.font.family) ? spec.font.family : opts[1]
    }
    if (this.#alignSelect) this.#alignSelect.value = spec.paragraph.align
    // ツールバー
    const spreadBtn = $('#btn-spread')
    spreadBtn.setAttribute('aria-pressed', String(spec.page.spread !== 'single'))
    spreadBtn.textContent = spec.page.spread === 'single' ? '単ページ' : spec.page.spread === 'spread' ? '見開き' : '見開き(自動)'
    const writingBtn = $('#btn-writing')
    writingBtn.setAttribute('aria-pressed', String(isVertical(spec.writingMode)))
    writingBtn.textContent = isVertical(spec.writingMode) ? '縦組み' : '横組み'
  }

  #syncJSON() {
    if (this.#jsonArea && document.activeElement !== this.#jsonArea)
      this.#jsonArea.value = serializeSpec(this.#spec)
  }

  #importJSON(text) {
    const { spec, warnings } = parseKumihan(text)
    this.#setSpec(spec, { immediate: true })
    this.#setNotice(warnings.length ? warnings.join(' / ') : '組式を読み込みました', warnings.length ? 'warn' : '')
    this.#toast('組式を適用しました')
  }

  // ---------- クローム / 操作 ----------
  #wireChrome() {
    $('#btn-open').addEventListener('click', () => this.els.fileInput.click())
    $('#btn-open-2').addEventListener('click', () => this.els.fileInput.click())
    this.els.fileInput.addEventListener('change', () => {
      const file = this.els.fileInput.files?.[0]
      if (file) this.open(file).catch(e => this.#error(e))
      this.els.fileInput.value = ''
    })

    $('#btn-settings').addEventListener('click', () => this.#togglePanel('settings'))
    $('#btn-toc').addEventListener('click', () => this.#togglePanel('sidebar'))
    $('#btn-close-settings').addEventListener('click', () => this.#closePanels())
    $('#btn-close-toc').addEventListener('click', () => this.#closePanels())
    this.els.scrim.addEventListener('click', () => this.#closePanels())

    $('#btn-spread').addEventListener('click', () => {
      const next = this.#spec.page.spread === 'single' ? 'spread' : 'single'
      this.#commit(setPath('page.spread', next), { immediate: true })
    })
    $('#btn-writing').addEventListener('click', () => {
      const next = isVertical(this.#spec.writingMode) ? 'horizontal-tb' : 'vertical-rl'
      this.#commit(setPath('writingMode', next), { immediate: true })
    })

    $('#btn-prev').addEventListener('click', () => this.#reader?.goLeft())
    $('#btn-next').addEventListener('click', () => this.#reader?.goRight())
    this.els.slider.addEventListener('input', e => this.#reader?.goToFraction(Number(e.target.value)))

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.els.lightbox.hidden) { this.#hideLightbox(); return }
      if (e.target.closest?.('input, textarea, select')) return
      this.#reader?.handleKey(e)
    })

    $('#lightbox-close').addEventListener('click', () => this.#hideLightbox())
    this.els.lightbox.addEventListener('click', e => {
      if (e.target === this.els.lightbox || e.target === this.els.lightboxImg) this.#hideLightbox()
    })
  }

  #wireDropTarget() {
    const target = this.els.dropTarget
    target.addEventListener('dragover', e => { e.preventDefault(); target.classList.add('dragover') })
    target.addEventListener('dragleave', () => target.classList.remove('dragover'))
    target.addEventListener('drop', e => {
      e.preventDefault()
      target.classList.remove('dragover')
      const item = [...e.dataTransfer.items].find(i => i.kind === 'file')
      if (!item) return
      const entry = item.webkitGetAsEntry?.()
      if (entry && !entry.isFile) {
        this.#toast('フォルダは未対応です。EPUB ファイルを選択してください', 'error')
        return
      }
      const file = item.getAsFile()
      if (file) this.open(file).catch(err => this.#error(err))
    })
  }

  #togglePanel(which) {
    const panel = which === 'settings' ? this.els.settings : this.els.sidebar
    const other = which === 'settings' ? this.els.sidebar : this.els.settings
    const open = !panel.classList.contains('open')
    other.classList.remove('open')
    other.setAttribute('aria-hidden', 'true')
    panel.classList.toggle('open', open)
    panel.setAttribute('aria-hidden', String(!open))
    $('#btn-settings').setAttribute('aria-expanded', String(which === 'settings' ? open : false))
    this.els.scrim.hidden = !open && !this.els.sidebar.classList.contains('open')
  }

  #closePanels() {
    this.els.settings.classList.remove('open')
    this.els.sidebar.classList.remove('open')
    this.els.settings.setAttribute('aria-hidden', 'true')
    this.els.sidebar.setAttribute('aria-hidden', 'true')
    this.els.scrim.hidden = true
    $('#btn-settings').setAttribute('aria-expanded', 'false')
  }

  // ---------- カラーテーマ / 外枠 ----------
  #initUiTheme() {
    let v = 'auto'
    try { v = localStorage.getItem(UI_THEME_KEY) || 'auto' } catch { /* ignore */ }
    this.#setUiTheme(v, false)
  }

  #setUiTheme(value, persist = true) {
    this.#uiTheme = ['auto', 'light', 'dark'].includes(value) ? value : 'auto'
    if (this.#uiTheme === 'auto') delete document.documentElement.dataset.uiTheme
    else document.documentElement.dataset.uiTheme = this.#uiTheme
    if (persist) { try { localStorage.setItem(UI_THEME_KEY, this.#uiTheme) } catch { /* ignore */ } }
    if (this.#uiThemeSelect) this.#uiThemeSelect.value = this.#uiTheme
  }

  // 組式 (余白/外枠) を閲覧領域へ反映
  #applyFrame() {
    const view = this.els.view
    if (!view || !this.#spec) return
    const { page } = this.#spec
    const f = page.frame
    view.style.setProperty('--page-inset', `${Math.round(page.inset)}px`)
    view.style.setProperty('--frame-width', f.enabled ? `${f.width}px` : '0px')
    view.style.setProperty('--frame-style', f.style)
    view.style.setProperty('--frame-color', f.color || 'var(--line)')
    view.style.setProperty('--frame-radius', `${f.radius}px`)
  }

  // 綴り方向に合わせてプログレスバーと進む/戻るボタンの説明を揃える
  #updateDirection() {
    const rtl = this.#reader?.pageDirection === 'rtl'
    const dir = rtl ? 'rtl' : 'ltr'
    this.els.slider.dir = dir
    this.els.ticks.dir = dir
    const left = $('#btn-prev')
    const right = $('#btn-next')
    // 左ボタン = #btn-prev は goLeft()、右ボタン = #btn-next は goRight() を呼ぶ。
    // 右綴じ(rtl)では左が「次へ」、左綴じ(ltr)では右が「次へ」。
    const leftLabel = rtl ? '次へ' : '前へ'
    const rightLabel = rtl ? '前へ' : '次へ'
    left.title = leftLabel
    left.setAttribute('aria-label', leftLabel)
    right.title = rightLabel
    right.setAttribute('aria-label', rightLabel)
  }

  // ---------- 挿絵ズーム ----------
  #showLightbox(src, alt) {
    if (!src) return
    this.els.lightboxImg.src = src
    this.els.lightboxImg.alt = alt || '挿絵'
    this.els.lightbox.hidden = false
  }

  #hideLightbox() {
    this.els.lightbox.hidden = true
    this.els.lightboxImg.removeAttribute('src')
  }

  // ---------- 書籍表示 ----------
  #onOpened() {
    this.els.dropTarget.classList.add('hidden')
    const book = this.#reader.book
    const title = formatLanguageMap(book?.metadata?.title) || '無題の書籍'
    document.title = `${title} — migitoji`
    this.#setTitle(title, formatContributor(book?.metadata?.author))
    this.#buildTOC(book?.toc ?? [])
    $('#btn-toc').disabled = !(book?.toc?.length)
    $('#btn-prev').disabled = false
    $('#btn-next').disabled = false
    this.els.slider.disabled = false
    this.#applyFrame()
    this.#updateDirection()
    this.#buildTicks()
    if (this.#reader.isFixedLayout)
      this.#toast('固定レイアウトの書籍です。組式設定は本文に反映されません。', 'warn')
  }

  #setTitle(title, author) {
    const text = author ? `${title} — ${author}` : title
    this.els.title.textContent = text
    this.els.title.title = text
  }

  #buildTOC(toc) {
    const nav = this.els.toc
    nav.replaceChildren()
    if (!toc.length) { nav.append(el('p', { class: 'notice', style: 'padding:12px' }, '目次がありません')); return }
    const build = (items, depth = 0) => {
      const ul = el('ul')
      for (const item of items) {
        const li = el('li')
        const a = el('a', { href: '#', role: 'link' }, item.label || '（無題）')
        a.addEventListener('click', e => {
          e.preventDefault()
          this.#reader.goTo(item.href).catch(err => this.#error(err))
          this.#closePanels()
        })
        li.append(a)
        if (item.subitems?.length && depth < 6) li.append(build(item.subitems, depth + 1))
        ul.append(li)
      }
      return ul
    }
    nav.append(build(toc))
  }

  // 目次の章ごとのチェックポイントを描画（仕切り線のみ、深さで大きさを変える）
  #buildTicks() {
    const container = this.els.ticks
    container.replaceChildren()
    if (!this.#reader) return
    let marks = []
    try { marks = this.#reader.tocFractions() } catch (e) { console.warn(e) }
    if (!marks.length) { container.hidden = true; return }
    container.hidden = false
    const seen = new Set()
    for (const { fraction, depth, label } of marks) {
      const pos = Math.max(0, Math.min(100, fraction * 100))
      const key = `${depth}:${pos.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      const tick = el('div', { class: `tick depth-${Math.min(depth, 4)}` })
      tick.style.setProperty('--pos', `${pos}%`)
      tick.title = label ?? ''
      container.append(tick)
    }
  }

  #ensureProgressVisibility() {
    this.els.slider.style.visibility = 'visible'
  }

  #onRelocate(detail) {
    const { fraction, location, pageItem, tocItem } = detail
    this.#updateDirection()
    this.els.slider.value = String(fraction ?? 0)
    const percent = percentFormat.format(fraction ?? 0)
    const loc = pageItem?.label
      ? `ページ ${pageItem.label}`
      : location ? `位置 ${location.current} / ${location.total}` : ''
    this.els.progressLabel.textContent = `${percent}${loc ? ' ・ ' + loc : ''}`
    this.els.slider.title = `${percent}${tocItem?.label ? ' ・ ' + tocItem.label : ''}`
  }

  // ---------- ユーティリティ ----------
  #setNotice(msg, type = '') {
    if (!this.#jsonNotice) return
    this.#jsonNotice.textContent = msg ?? ''
    this.#jsonNotice.className = `notice${type ? ' ' + type : ''}`
  }

  #toast(message, type = '') {
    const toast = this.els.toast
    toast.textContent = message
    toast.className = type
    toast.hidden = false
    clearTimeout(this.#toastTimer)
    this.#toastTimer = setTimeout(() => { toast.hidden = true }, 4200)
  }

  #error(e) {
    console.error(e)
    this.#toast(e?.message ?? String(e), 'error')
  }
}
