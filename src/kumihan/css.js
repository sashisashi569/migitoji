// 組式仕様 -> 電子書籍 iframe へ注入する CSS / paginator 属性への変換。
import { isPlainObject, isVertical } from './spec.js'

const cssEscapeString = s => String(s).replace(/["\\]/g, '\\$&')

const fontFaces = fonts => (Array.isArray(fonts) ? fonts : []).map(f => {
  const weight = typeof f.weight === 'number' ? String(f.weight) : (f.weight ?? 'normal')
  return `@font-face {
    font-family: "${cssEscapeString(f.family)}";
    src: ${f.src};
    font-weight: ${weight};
    font-style: ${f.style ?? 'normal'};
    font-display: ${f.display ?? 'swap'};
  }`
}).join('\n')

// 本文用の内蔵カラーテーマ (colors.theme)。
export const CONTENT_THEMES = {
  light: { background: '#ffffff', color: '#222222', colorScheme: 'light' },
  sepia: { background: '#f4ecd8', color: '#3a3226', colorScheme: 'light' },
  dark: { background: '#121417', color: '#d8d3c8', colorScheme: 'dark' },
}

// colors.* を解決して実際の background/color/color-scheme を返す。
export const resolveContentColors = spec => {
  const { colors = {} } = spec
  const theme = colors.theme && !['auto', 'custom'].includes(colors.theme)
    ? CONTENT_THEMES[colors.theme] : null
  return {
    background: colors.background ?? theme?.background ?? null,
    color: colors.color ?? theme?.color ?? null,
    colorScheme: theme?.colorScheme ?? 'light dark',
  }
}

const trimValue = (trimStart, trimEnd) => {
  if (trimStart && trimEnd) return 'trim-both'
  if (trimStart) return 'trim-start'
  if (trimEnd) return 'trim-end'
  return 'normal'
}

// 組式仕様から、本文へ適用する CSS 文字列を生成する。
export const buildCSS = spec => {
  const v = isVertical(spec.writingMode) ? 'vertical' : 'horizontal'
  const wm = spec.writingMode
  const { font, paragraph, punctuation, ruby, heading } = spec
  const colors = resolveContentColors(spec)
  const marginInline = paragraph.indent
  const hanging = punctuation.hanging
    ? (paragraph.hangingPunctuation || 'allow-end last')
    : 'none'
  const betweenStart = paragraph.marginTop + paragraph.spacingBetween

  const parts = []

  parts.push(`@namespace epub "http://www.idpf.org/2007/ops";`)

  const faces = fontFaces(spec.fonts)
  if (faces) parts.push(faces)

  if (colors.background || colors.color) {
    parts.push(`html {
      ${colors.background ? `background: ${colors.background} !important;` : ''}
      ${colors.color ? `color: ${colors.color} !important;` : ''}
    }`)
  }

  parts.push(`html {
    color-scheme: ${colors.colorScheme};
    writing-mode: ${wm} !important;
    -webkit-writing-mode: ${wm} !important;
  }`)

  parts.push(`/* https://github.com/whatwg/html/issues/5426 */
  @media (prefers-color-scheme: dark) {
    a:link { color: lightblue; }
  }`)

  parts.push(`body {
    writing-mode: ${wm} !important;
    -webkit-writing-mode: ${wm} !important;
    font-family: ${font.family};
    font-size: ${font.size}px;
    font-weight: ${font.weight};
    font-style: ${font.style};
    line-height: ${font.lineHeight};
    letter-spacing: ${font.letterSpacing}em;
    word-spacing: ${font.wordSpacing}em;
    text-align: ${paragraph.align};
    text-justify: ${paragraph.align === 'justify' ? 'inter-ideograph' : 'auto'};
    font-kerning: ${font.kerning ? 'normal' : 'none'};
    ${font.features ? `font-feature-settings: ${font.features};` : ''}
    ${font.variation ? `font-variation-settings: ${font.variation};` : ''}
    hanging-punctuation: ${hanging};
    text-autospace: ${punctuation.autospace};
    text-spacing-trim: ${trimValue(punctuation.trimStart, punctuation.trimEnd)};
    -webkit-text-size-adjust: 100%;
    ${colors.background ? `background: ${colors.background} !important;` : ''}
    ${colors.color ? `color: ${colors.color} !important;` : ''}
  }`)

  parts.push(`p, li, blockquote, dd, dt, figcaption, div.paragraph {
    line-height: ${font.lineHeight};
    text-align: ${paragraph.align};
    line-break: ${paragraph.lineBreak};
    word-break: ${paragraph.wordBreak};
    overflow-wrap: break-word;
    widows: ${paragraph.widows};
    orphans: ${paragraph.orphans};
    margin-block-start: ${paragraph.marginTop}em;
    margin-block-end: ${paragraph.marginBottom}em;
    -webkit-hyphens: manual;
    hyphens: manual;
  }`)

  parts.push(`p {
    text-indent: ${marginInline}em;
    margin: 0;
  }
  p + p { margin-block-start: ${betweenStart}em; }
  /* 見出し直後・罫線直後は字下げしない */
  h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p,
  hr + p, blockquote + p, figure + p, table + p {
    text-indent: 0;
  }`)

  // 見出しを行グリッドに乗せる。UA 既定の行送り・余白・サイズのままだと
  // 見出しのある面だけ行数が大きくずれるため、行ボックスを lineAdvance の
  // 整数倍にし、余白を 0 にしてサイズも組式側で固定する。
  // サイズは組式 heading.sizes (h1〜h6 の本文比) で指定する。
  if (heading?.enabled !== false) {
    const sizes = heading?.sizes ?? [2, 1.5, 1.3, 1.15, 1, 1]
    parts.push(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag, i) => {
      const k = Number.isFinite(sizes[i]) && sizes[i] > 0 ? sizes[i] : 1
      const lines = Math.max(1, Math.ceil(k / font.lineHeight))
      const hlh = +((lines * font.lineHeight) / k).toFixed(4)
      return `${tag} {
    font-size: ${k}em;
    line-height: ${hlh};
    margin: 0;
    text-indent: 0;
    font-weight: bold;
  }`
    }).join('\n'))
  }

  parts.push(`ruby {
    ruby-position: ${ruby.position};
    ruby-align: ${ruby.align};
  }
  rt {
    font-size: ${ruby.size}em;
    letter-spacing: ${ruby.letterSpacing}em;
  }`)

  // 縦組みでは欧文の回転を許可 (mixed)。横組み時の調整も同様。
  parts.push(`/* prevent the above from overriding the align attribute */
  [align="left"] { text-align: left; }
  [align="right"] { text-align: right; }
  [align="center"] { text-align: center; }
  [align="justify"] { text-align: justify; }

  pre { white-space: pre-wrap !important; }
  img, svg, video { max-width: 100%; max-height: 100%; object-fit: contain; }
  a { color: inherit; }
  table { border-collapse: collapse; }`)

  if (v === 'vertical') {
    // 縦組み特有の微調整 (欧文・約物)
    parts.push(`/* 縦組み: 和欧混植時の詰めを自然にする */
  .tcy, .tate-chu-yoko { text-combine-upright: digits 2; }
  code, kbd, samp, pre { text-orientation: mixed; }`)
  }

  if (spec.customCSS) parts.push(spec.customCSS)

  return parts.filter(Boolean).join('\n\n')
}

// 見開きの倍率。単ページ = 1面ぶん / 見開き = columnCount 面ぶん。
const spreadFactor = page => page.spread === 'single' ? 1
  : Math.max(2, page.columnCount)

// 横組みで紙幅（段数方向）を求めるための段数。縦組みは常に1段なので使わない。
export const spreadColumnCount = spec => spreadFactor(spec.page)

const clampPx = v => Math.min(8000, Math.max(120, Math.round(v)))

// 縦組みの paginator 属性。通常は紙が縦長（字詰め方向が長い）になる。
//   面高(インライン長) = 1行の長さ = max-inline-size − gap
//   面幅(ブロック長)   = 行が積まれる方向 = max-block-size（見開きで倍率ぶん広がる）
//   すなわち max-inline-size が字詰めを、max-block-size が行数を決める。
//   paginator の多段は縦組みでは縦方向に積まれて見開きにならないため、段数は常に 1 とし、
//   見開きは面を段数方向に広げる（ワイドな単ページ）。
const verticalOptions = (page, font) => {
  const lineAdvance = font.size * font.lineHeight
  const charAdvance = font.size * (1 + font.letterSpacing)
  const g = page.gap / 100
  const h = g / (1 - g)
  const factor = 1 - h
  const inlineSize = (page.charsPerLine * charAdvance) / (factor > 0.05 ? factor : 0.05)
  const blockSize = spreadFactor(page) * page.linesPerPage * lineAdvance
  return {
    flow: 'paginated',
    gap: `${Math.min(45, Math.max(0, Math.round(page.gap)))}%`,
    margin: `${Math.round(page.margin)}px`,
    'max-inline-size': `${clampPx(inlineSize)}px`,
    'max-block-size': `${clampPx(blockSize)}px`,
    'max-column-count': '1',
  }
}

// 横組みの paginator 属性。紙は横長になり、見開きは 2段（max-column-count）で表現する。
//   max-block-size(高さ) = 行数 × 行送り
//   max-inline-size(幅)  = 1段ぶんの字詰め（段数ぶんの紙幅は paperSizeOf が掛ける）
const horizontalOptions = (page, font) => {
  const lineAdvance = font.size * font.lineHeight
  const charAdvance = font.size * (1 + font.letterSpacing)
  const g = page.gap / 100
  const h = g / (1 - g)
  const blockCount = spreadFactor(page)
  const factor = 1 - blockCount * h
  const inlineSize = (page.charsPerLine * charAdvance) / (factor > 0.05 ? factor : 0.05)
  const blockSize = page.linesPerPage * lineAdvance
  return {
    flow: 'paginated',
    gap: `${page.gap}%`,
    margin: `${Math.round(page.margin)}px`,
    'max-inline-size': `${clampPx(inlineSize)}px`,
    'max-block-size': `${clampPx(blockSize)}px`,
    'max-column-count': String(blockCount),
  }
}

// 組式（字詰め・行数）から paginator の論理サイズ属性へ変換する。
//
// 組方向 (writingMode) が「文字送り方向」を、綴じ方向 (binding) が「紙の向き」を決める。
// binding: auto は組方向から導出 (縦組み=縦綴じ=縦長 / 横組み=横綴じ=横長)。
//
// 綴じ方向が組方向の自然な向きと食い違う場合 (例: 縦綴じ + 横組み) は、紙の向きを
// 保ったままインライン/ブロックを入れ替える。これにより紙は縦長のまま、文字だけ横組みで流れる。
//
// paginator は段幅から gap を差し引くため、その分 (h = g/(1-g)) は各 branch で補正。
export const toRenderOptions = spec => {
  const { page, font } = spec
  const vertical = isVertical(spec.writingMode)
  const binding = spec.binding ?? 'auto'

  // 見開きの表現方法は組方向で異なる:
  //   横組み = 多段（2段）で表現 / 縦組み = 1段のまま面を広げる（ワイドな単ページ）。
  const opts = vertical ? verticalOptions(page, font) : horizontalOptions(page, font)
  const paperVertical = binding === 'auto' ? vertical : binding === 'vertical'
  if (paperVertical === vertical) return opts

  // 綴じ方向が組方向と食い違う場合は、紙の向きを保ったままインライン/ブロックを入れ替える。
  return {
    flow: 'paginated',
    gap: opts.gap,
    margin: opts.margin,
    'max-inline-size': opts['max-block-size'],
    'max-block-size': opts['max-inline-size'],
    'max-column-count': opts['max-column-count'],
  }
}

// 組式を変更しても再読込が必須かどうか (組方向・綴じ方向が変わるとき)。
export const requiresReload = (a, b) =>
  !isPlainObject(a) || !isPlainObject(b)
  || a.writingMode !== b.writingMode
  || a.direction !== b.direction
  || a.binding !== b.binding
