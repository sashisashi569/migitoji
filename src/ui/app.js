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
  { path: 'page.margin', label: '天地余白', min: 0, max: 200, step: 2, unit: 'px' },
  { path: 'page.gap', label: '段間', min: 0, max: 24, step: 0.5, unit: '%' },
  { path: 'page.charsPerLine', label: '字詰め', min: 8, max: 80, step: 1, unit: '字' },
  { path: 'page.linesPerPage', label: '行数', min: 4, max: 48, step: 1, unit: '行' },
]

export class App {
  #reader = null
  #spec = null
  #controls = []
  #applyTimer = null
  #toastTimer = null
  #presetSelect = null
  #familySelect = null
  #alignSelect = null
  #jsonArea = null
  #jsonNotice = null

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
    }
  }

  init() {
    this.#spec = normalizeSpec(loadStoredSpec() ?? getPreset('bunko-vertical') ?? defaultSpec()).spec
    this.#buildSettings()
    this.#wireChrome()
    this.#wireDropTarget()
    this.#syncControls()
    this.#syncJSON()

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
    body.append(this.#sectionJSON())
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
      '字詰め・行数が出版社の組式にあたる数値です。行数は、横組みでは本文の高さ、縦組みでは本文の幅として組版されます（見開き/単ページはこの幅・高さで切り替わります）。画面が小さい場合は表示できる行数までに制限されます。縦組みは描画ライブラリの制約により面の縦横比が字詰めと行数から自動決定されるため、字詰めは行数に連動します（参考値）。'))
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
    if (this.#reader?.view) {
      this.#reader.setSpec(this.#spec).catch(e => this.#error(e))
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
        c.input.checked = (v === c.value)
      }
    }
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
      if (e.target.closest?.('input, textarea, select')) return
      this.#reader?.handleKey(e)
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

  #buildTicks() {
    this.els.ticks.replaceChildren()
    try {
      for (const f of this.#reader.sectionFractions)
        this.els.ticks.append(el('option', { value: f }))
    } catch { /* noop */ }
  }

  #ensureProgressVisibility() {
    this.els.slider.style.visibility = 'visible'
  }

  #onRelocate(detail) {
    const { fraction, location, pageItem, tocItem } = detail
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
