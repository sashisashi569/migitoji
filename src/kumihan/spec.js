// 組式 (kumihan) 仕様のスキーマ定義・正規化・検証。
// 依存ゼロ。ブラウザでも Node.js でも動作する純粋関数のみ。

export const SPEC_VERSION = 1

export const WRITING_MODES = ['vertical-rl', 'vertical-lr', 'horizontal-tb']
export const TEXT_ALIGNS = ['justify', 'start', 'end', 'left', 'right', 'center']
export const LINE_BREAKS = ['auto', 'loose', 'normal', 'strict', 'anywhere']
export const WORD_BREAKS = ['normal', 'break-all', 'keep-all', 'break-word']
export const RUBY_POSITIONS = ['over', 'under', 'inter-character', 'auto']
export const RUBY_ALIGNS = ['center', 'start', 'space-between', 'space-around']
export const AUTOSPACE = ['normal', 'none', 'no-autospace', 'ideograph-alpha ideograph-numeric']
export const SPREAD = ['auto', 'spread', 'single']

export const isPlainObject = x =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

export const isVertical = writingMode =>
  typeof writingMode === 'string' && writingMode.startsWith('vertical')

export const defaultSpec = () => ({
  version: SPEC_VERSION,
  id: 'custom',
  name: 'カスタム組式',
  description: '',
  writingMode: 'vertical-rl',
  direction: 'auto',
  font: {
    family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif",
    size: 15,
    weight: 400,
    style: 'normal',
    lineHeight: 1.7,
    letterSpacing: 0.02,
    wordSpacing: 0,
    kerning: true,
    features: '"palt" 0',
    variation: '',
  },
  paragraph: {
    indent: 1,
    align: 'justify',
    lineBreak: 'strict',
    wordBreak: 'normal',
    hangingPunctuation: 'allow-end last',
    widows: 2,
    orphans: 2,
    marginTop: 0,
    marginBottom: 0,
    spacingBetween: 0,
  },
  punctuation: {
    autospace: 'normal',
    trimStart: false,
    trimEnd: false,
    hanging: true,
  },
  ruby: {
    size: 0.5,
    position: 'over',
    align: 'center',
    letterSpacing: 0,
  },
  // 見出し (h1〜h6) の本文比サイズ (em)。
  // enabled のとき、行ボックスが行送りの整数倍になるよう自動調整して行グリッドに乗せる。
  heading: {
    enabled: true,
    sizes: [2, 1.5, 1.3, 1.15, 1, 1],
  },
  page: {
    margin: 48,
    gap: 7,
    // 組式の字詰め・行数 (出版社の組版仕様に対応)。
    // 横組み: 行数→高さ / 縦組み: 行数→幅 に写像される。
    charsPerLine: 40,
    linesPerPage: 17,
    columnCount: 2,
    spread: 'auto',
    // 余白: 本文領域の外側に確保する余白 (px)
    inset: 0,
    // 外枠: 本文領域を囲む枠線
    frame: { enabled: false, width: 1, color: null, style: 'solid', radius: 0 },
  },
  // 現在の章ラベルの位置 (単ページ / 見開き で別々に指定)
  runningHead: {
    enabled: true,
    single: { slot: 'head', align: 'center' },
    spread: { slot: 'head', align: 'center' },
  },
  // ページ番号の位置 (単ページ / 見開き で別々に指定)
  pageNumber: {
    enabled: true,
    single: { slot: 'foot', align: 'center' },
    spread: { slot: 'foot', align: 'center' },
  },
  colors: {
    // カラーテーマ: auto | light | dark | sepia | custom
    theme: 'auto',
    background: null,
    color: null,
  },
  fonts: [],
  customCSS: '',
})

export const CONTENT_THEMES = ['auto', 'light', 'dark', 'sepia', 'custom']
export const HEAD_SLOTS = ['head', 'foot']
export const HEAD_ALIGNS = ['start', 'center', 'end']
export const FRAME_STYLES = ['none', 'solid', 'double', 'dashed', 'dotted']

const warnings = []
const warn = msg => { warnings.push(msg) }

const num = (v, def, { min = -Infinity, max = Infinity, label } = {}) => {
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v)
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    if (v !== undefined) warn(`${label}: 数値ではないため既定値 ${def} を使用します`)
    return def
  }
  const clamped = Math.min(max, Math.max(min, v))
  if (clamped !== v) warn(`${label}: 範囲外のため ${clamped} に補正しました`)
  return clamped
}

const int = (v, def, opts = {}) => Math.round(num(v, def, opts))

const str = (v, def, { label, maxLen = 4096 } = {}) => {
  if (v === undefined || v === null) return def
  if (typeof v !== 'string') {
    warn(`${label}: 文字列ではないため既定値を使用します`)
    return def
  }
  return v.slice(0, maxLen)
}

const bool = (v, def, { label } = {}) => {
  if (v === undefined) return def
  if (typeof v === 'boolean') return v
  warn(`${label}: 真偽値ではないため既定値を使用します`)
  return def
}

const oneOf = (v, def, list, label) => {
  if (v === undefined) return def
  if (list.includes(v)) return v
  warn(`${label}: "${v}" は無効値のため "${def}" を使用します`)
  return def
}

// 色は簡易サニタイズ。`;` や `{}` を含むものは拒否して既定値へ。
const color = (v, def, label) => {
  if (v === undefined || v === null || v === '' || v === 'auto') return def
  if (typeof v !== 'string' || /[;{}<>]/.test(v)) {
    warn(`${label}: 無効な色指定のため無視します`)
    return def
  }
  return v
}

const slotOf = (v, def, label) => {
  const o = isPlainObject(v) ? v : {}
  return {
    slot: oneOf(o.slot, def.slot, HEAD_SLOTS, `${label}.slot`),
    align: oneOf(o.align, def.align, HEAD_ALIGNS, `${label}.align`),
  }
}

const normalizeFontFace = (v, i) => {
  if (!isPlainObject(v) || typeof v.src !== 'string' || typeof v.family !== 'string') {
    warn(`fonts[${i}]: family と src が必須のため無視します`)
    return null
  }
  return {
    family: str(v.family, '', { label: `fonts[${i}].family`, maxLen: 200 }),
    src: str(v.src, '', { label: `fonts[${i}].src`, maxLen: 2000 }),
    weight: (typeof v.weight === 'number' || typeof v.weight === 'string') ? v.weight : 'normal',
    style: oneOf(v.style, 'normal', ['normal', 'italic', 'oblique'], `fonts[${i}].style`),
    display: oneOf(v.display, 'swap', ['auto', 'block', 'swap', 'fallback', 'optional'], `fonts[${i}].display`),
  }
}

// 任意の入力を完全な組式仕様へ正規化する。
// 戻り値: { spec, warnings }
export const normalizeSpec = input => {
  warnings.length = 0
  const d = defaultSpec()
  if (!isPlainObject(input)) {
    if (input !== undefined && input !== null)
      warn('組式データがオブジェクトではないため既定値を使用します')
    return { spec: d, warnings: [...warnings] }
  }

  const f = isPlainObject(input.font) ? input.font : {}
  const p = isPlainObject(input.paragraph) ? input.paragraph : {}
  const pu = isPlainObject(input.punctuation) ? input.punctuation : {}
  const rb = isPlainObject(input.ruby) ? input.ruby : {}
  const hd = isPlainObject(input.heading) ? input.heading : {}
  const pg = isPlainObject(input.page) ? input.page : {}
  const co = isPlainObject(input.colors) ? input.colors : {}

  const spec = {
    version: SPEC_VERSION,
    id: str(input.id, d.id, { label: 'id', maxLen: 200 }),
    name: str(input.name, d.name, { label: 'name', maxLen: 200 }),
    description: str(input.description, d.description, { label: 'description', maxLen: 2000 }),
    writingMode: oneOf(input.writingMode, d.writingMode, WRITING_MODES, 'writingMode'),
    direction: oneOf(input.direction, d.direction, ['auto', 'rtl', 'ltr'], 'direction'),
    font: {
      family: str(f.family, d.font.family, { label: 'font.family', maxLen: 500 }),
      size: num(f.size, d.font.size, { min: 8, max: 72, label: 'font.size' }),
      weight: (() => {
        const w = f.weight
        if (typeof w === 'number' && Number.isFinite(w)) return Math.min(900, Math.max(100, Math.round(w / 100) * 100))
        if (typeof w === 'string' && /^(normal|bold|bolder|lighter|[1-9]00)$/.test(w)) return w
        if (w !== undefined) warn('font.weight: 無効値のため 400 を使用します')
        return d.font.weight
      })(),
      style: oneOf(f.style, d.font.style, ['normal', 'italic', 'oblique'], 'font.style'),
      lineHeight: num(f.lineHeight, d.font.lineHeight, { min: 0.8, max: 4, label: 'font.lineHeight' }),
      letterSpacing: num(f.letterSpacing, d.font.letterSpacing, { min: -0.2, max: 1, label: 'font.letterSpacing' }),
      wordSpacing: num(f.wordSpacing, d.font.wordSpacing, { min: -0.5, max: 2, label: 'font.wordSpacing' }),
      kerning: bool(f.kerning, d.font.kerning, { label: 'font.kerning' }),
      features: str(f.features, d.font.features, { label: 'font.features', maxLen: 300 }),
      variation: str(f.variation, d.font.variation, { label: 'font.variation', maxLen: 300 }),
    },
    paragraph: {
      indent: num(p.indent, d.paragraph.indent, { min: 0, max: 4, label: 'paragraph.indent' }),
      align: oneOf(p.align, d.paragraph.align, TEXT_ALIGNS, 'paragraph.align'),
      lineBreak: oneOf(p.lineBreak, d.paragraph.lineBreak, LINE_BREAKS, 'paragraph.lineBreak'),
      wordBreak: oneOf(p.wordBreak, d.paragraph.wordBreak, WORD_BREAKS, 'paragraph.wordBreak'),
      hangingPunctuation: str(p.hangingPunctuation, d.paragraph.hangingPunctuation, { label: 'paragraph.hangingPunctuation', maxLen: 100 }),
      widows: int(p.widows, d.paragraph.widows, { min: 0, max: 10, label: 'paragraph.widows' }),
      orphans: int(p.orphans, d.paragraph.orphans, { min: 0, max: 10, label: 'paragraph.orphans' }),
      marginTop: num(p.marginTop, d.paragraph.marginTop, { min: 0, max: 10, label: 'paragraph.marginTop' }),
      marginBottom: num(p.marginBottom, d.paragraph.marginBottom, { min: 0, max: 10, label: 'paragraph.marginBottom' }),
      spacingBetween: num(p.spacingBetween, d.paragraph.spacingBetween, { min: 0, max: 5, label: 'paragraph.spacingBetween' }),
    },
    punctuation: {
      autospace: oneOf(pu.autospace, d.punctuation.autospace, AUTOSPACE, 'punctuation.autospace'),
      trimStart: bool(pu.trimStart, d.punctuation.trimStart, { label: 'punctuation.trimStart' }),
      trimEnd: bool(pu.trimEnd, d.punctuation.trimEnd, { label: 'punctuation.trimEnd' }),
      hanging: bool(pu.hanging, d.punctuation.hanging, { label: 'punctuation.hanging' }),
    },
    ruby: {
      size: num(rb.size, d.ruby.size, { min: 0.1, max: 1, label: 'ruby.size' }),
      position: oneOf(rb.position, d.ruby.position, RUBY_POSITIONS, 'ruby.position'),
      align: oneOf(rb.align, d.ruby.align, RUBY_ALIGNS, 'ruby.align'),
      letterSpacing: num(rb.letterSpacing, d.ruby.letterSpacing, { min: -0.2, max: 0.5, label: 'ruby.letterSpacing' }),
    },
    heading: {
      enabled: bool(hd.enabled, d.heading.enabled, { label: 'heading.enabled' }),
      sizes: (() => {
        const arr = Array.isArray(hd.sizes) ? hd.sizes : []
        return d.heading.sizes.map((def, i) =>
          num(arr[i], def, { min: 0.5, max: 4, label: `heading.sizes[${i}]` }))
      })(),
    },
    page: {
      margin: num(pg.margin, d.page.margin, { min: 0, max: 400, label: 'page.margin' }),
      gap: num(pg.gap, d.page.gap, { min: 0, max: 30, label: 'page.gap' }),
      charsPerLine: int(pg.charsPerLine, d.page.charsPerLine, { min: 1, max: 120, label: 'page.charsPerLine' }),
      linesPerPage: int(pg.linesPerPage, d.page.linesPerPage, { min: 1, max: 100, label: 'page.linesPerPage' }),
      columnCount: int(pg.columnCount, d.page.columnCount, { min: 1, max: 4, label: 'page.columnCount' }),
      spread: oneOf(pg.spread, d.page.spread, SPREAD, 'page.spread'),
      inset: num(pg.inset, d.page.inset, { min: 0, max: 200, label: 'page.inset' }),
      frame: (() => {
        const fr = isPlainObject(pg.frame) ? pg.frame : {}
        return {
          enabled: bool(fr.enabled, d.page.frame.enabled, { label: 'page.frame.enabled' }),
          width: num(fr.width, d.page.frame.width, { min: 0, max: 40, label: 'page.frame.width' }),
          color: color(fr.color, d.page.frame.color, 'page.frame.color'),
          style: oneOf(fr.style, d.page.frame.style, FRAME_STYLES, 'page.frame.style'),
          radius: num(fr.radius, d.page.frame.radius, { min: 0, max: 100, label: 'page.frame.radius' }),
        }
      })(),
    },
    runningHead: {
      enabled: bool(input.runningHead?.enabled, d.runningHead.enabled, { label: 'runningHead.enabled' }),
      single: slotOf(input.runningHead?.single, d.runningHead.single, 'runningHead.single'),
      spread: slotOf(input.runningHead?.spread, d.runningHead.spread, 'runningHead.spread'),
    },
    pageNumber: {
      enabled: bool(input.pageNumber?.enabled, d.pageNumber.enabled, { label: 'pageNumber.enabled' }),
      single: slotOf(input.pageNumber?.single, d.pageNumber.single, 'pageNumber.single'),
      spread: slotOf(input.pageNumber?.spread, d.pageNumber.spread, 'pageNumber.spread'),
    },
    colors: {
      theme: oneOf(co.theme, d.colors.theme, CONTENT_THEMES, 'colors.theme'),
      background: color(co.background, d.colors.background, 'colors.background'),
      color: color(co.color, d.colors.color, 'colors.color'),
    },
    fonts: Array.isArray(input.fonts)
      ? input.fonts.map(normalizeFontFace).filter(Boolean)
      : [],
    customCSS: str(input.customCSS, d.customCSS, { label: 'customCSS', maxLen: 20000 }),
  }

  return { spec, warnings: [...warnings] }
}

// 致命的な誤りだけを列挙する (スキーマとしての最低要件)。
export const validateSpec = input => {
  const errors = []
  const warns = []
  if (!isPlainObject(input)) {
    errors.push('組式データは JSON オブジェクトである必要があります')
    return { valid: false, errors, warnings: warns }
  }
  if (input.version !== undefined && input.version !== SPEC_VERSION)
    warns.push(`version ${input.version} は未対応です (現行 ${SPEC_VERSION})`)
  if (input.writingMode !== undefined && !WRITING_MODES.includes(input.writingMode))
    errors.push(`writingMode は ${WRITING_MODES.join(' / ')} のいずれかである必要があります`)
  if (input.page !== undefined && !isPlainObject(input.page))
    errors.push('page はオブジェクトである必要があります')
  if (input.font !== undefined && !isPlainObject(input.font))
    errors.push('font はオブジェクトである必要があります')
  return { valid: errors.length === 0, errors, warnings: warns }
}

// 深いマージ (プリセット + 差分)。配列は置換。
export const mergeSpec = (base, patch) => {
  if (!isPlainObject(patch)) return base
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? mergeSpec(base[k], v) : v
  }
  return out
}

// JSON Schema (エディタ補完・外部検証用)。
export const JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/migitoji/kumihan.schema.json',
  title: 'migitoji 組式 (Kumihan)',
  type: 'object',
  additionalProperties: true,
  $defs: {
    slot: {
      type: 'object',
      properties: {
        slot: { enum: HEAD_SLOTS, description: 'head=上/前, foot=下/後' },
        align: { enum: HEAD_ALIGNS },
      },
    },
  },
  properties: {
    version: { type: 'integer', const: SPEC_VERSION },
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    writingMode: { enum: WRITING_MODES, default: 'vertical-rl' },
    direction: { enum: ['auto', 'rtl', 'ltr'], default: 'auto' },
    font: {
      type: 'object',
      properties: {
        family: { type: 'string' },
        size: { type: 'number', minimum: 8, maximum: 72 },
        weight: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        style: { enum: ['normal', 'italic', 'oblique'] },
        lineHeight: { type: 'number', minimum: 0.8, maximum: 4 },
        letterSpacing: { type: 'number', minimum: -0.2, maximum: 1 },
        wordSpacing: { type: 'number', minimum: -0.5, maximum: 2 },
        kerning: { type: 'boolean' },
        features: { type: 'string' },
        variation: { type: 'string' },
      },
    },
    paragraph: {
      type: 'object',
      properties: {
        indent: { type: 'number', minimum: 0, maximum: 4 },
        align: { enum: TEXT_ALIGNS },
        lineBreak: { enum: LINE_BREAKS },
        wordBreak: { enum: WORD_BREAKS },
        hangingPunctuation: { type: 'string' },
        widows: { type: 'integer', minimum: 0, maximum: 10 },
        orphans: { type: 'integer', minimum: 0, maximum: 10 },
        marginTop: { type: 'number', minimum: 0, maximum: 10 },
        marginBottom: { type: 'number', minimum: 0, maximum: 10 },
        spacingBetween: { type: 'number', minimum: 0, maximum: 5 },
      },
    },
    punctuation: {
      type: 'object',
      properties: {
        autospace: { enum: AUTOSPACE },
        trimStart: { type: 'boolean' },
        trimEnd: { type: 'boolean' },
        hanging: { type: 'boolean' },
      },
    },
    ruby: {
      type: 'object',
      properties: {
        size: { type: 'number', minimum: 0.1, maximum: 1 },
        position: { enum: RUBY_POSITIONS },
        align: { enum: RUBY_ALIGNS },
        letterSpacing: { type: 'number', minimum: -0.2, maximum: 0.5 },
      },
    },
    heading: {
      type: 'object',
      description: '見出し (h1〜h6) の本文比サイズ',
      properties: {
        enabled: { type: 'boolean', description: '行グリッドに乗せる (余白0・行ボックスを整数行に)' },
        sizes: {
          type: 'array',
          items: { type: 'number', minimum: 0.5, maximum: 4 },
          minItems: 6,
          maxItems: 6,
          description: 'h1〜h6 の本文比 (em)',
        },
      },
    },
    page: {
      type: 'object',
      properties: {
        margin: { type: 'number', minimum: 0, maximum: 400 },
        gap: { type: 'number', minimum: 0, maximum: 30 },
        charsPerLine: { type: 'integer', minimum: 1, maximum: 120, description: '字詰め（1行の字数）' },
        linesPerPage: { type: 'integer', minimum: 1, maximum: 100, description: '1ページの行数（行が積まれる方向）' },
        columnCount: { type: 'integer', minimum: 1, maximum: 4 },
        spread: { enum: SPREAD },
        inset: { type: 'number', minimum: 0, maximum: 200, description: '余白（本文領域の外側）px' },
        frame: {
          type: 'object',
          description: '外枠',
          properties: {
            enabled: { type: 'boolean' },
            width: { type: 'number', minimum: 0, maximum: 40 },
            color: { type: ['string', 'null'] },
            style: { enum: FRAME_STYLES },
            radius: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
    runningHead: {
      type: 'object',
      description: '現在の章ラベルの位置',
      properties: {
        enabled: { type: 'boolean' },
        single: { $ref: '#/$defs/slot' },
        spread: { $ref: '#/$defs/slot' },
      },
    },
    pageNumber: {
      type: 'object',
      description: 'ページ番号の位置',
      properties: {
        enabled: { type: 'boolean' },
        single: { $ref: '#/$defs/slot' },
        spread: { $ref: '#/$defs/slot' },
      },
    },
    colors: {
      type: 'object',
      properties: {
        theme: { enum: CONTENT_THEMES, default: 'auto' },
        background: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] },
      },
    },
    fonts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['family', 'src'],
        properties: {
          family: { type: 'string' },
          src: { type: 'string' },
          weight: { type: ['number', 'string'] },
          style: { enum: ['normal', 'italic', 'oblique'] },
          display: { enum: ['auto', 'block', 'swap', 'fallback', 'optional'] },
        },
      },
    },
    customCSS: { type: 'string' },
  },
}
