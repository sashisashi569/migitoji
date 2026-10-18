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
  const { font, paragraph, punctuation, ruby, colors } = spec
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
    color-scheme: light dark;
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

// 有効な段数（見開き設定を反映）。
const effectiveColumnCount = page => page.spread === 'single' ? 1
  : page.spread === 'spread' ? Math.max(2, page.columnCount)
    : page.columnCount

// 組式（字詰め・行数）から paginator の論理サイズ属性へ変換する。
//
// 横組み: max-block-size(高さ) = 行数 × 行送り / max-inline-size(幅) = 字詰め × 字送り。
//   max-column-count が有効なので、見開き/単ページはそのまま反映される。
//
// 縦組み: 横長画面では max-column-count が無視され、面の幅が
//   `max-inline-size − gap` から導かれる（= ほぼ正方形になり、段数が制御できない）。
//   そこで max-inline-size を「行数 × 行送り」ぶんの面幅とし、max-block-size を
//   「ちょうど N 列ぶんの幅」に設定して、コンテナ幅側で見開き/単ページを制御する。
//   → max-column-count に依存せず段数が切り替わる。
//
// paginator は段幅から gap を差し引くため、その分 (h = g/(1-g)) を補正する。
export const toRenderOptions = spec => {
  const { page, font } = spec
  const vertical = isVertical(spec.writingMode)
  const lineAdvance = font.size * font.lineHeight
  const charAdvance = font.size * (1 + font.letterSpacing)
  const g = page.gap / 100
  const h = g / (1 - g) // 実際の gap は size の h 倍
  const blockCount = Math.max(1, Math.round(effectiveColumnCount(page)))

  let inlineSize, blockSize
  if (vertical) {
    // 横長画面では段数が1として扱われるため、gap 補正も1段で計算する。
    const factor = 1 - h
    const columnWidth = page.linesPerPage * lineAdvance // = 1面の幅
    inlineSize = columnWidth / (factor > 0.05 ? factor : 0.05)
    // コンテナ幅 = N 列ぶん（列幅 + 段間）ちょうど
    blockSize = inlineSize * (blockCount - h)
  } else {
    const factor = 1 - blockCount * h
    inlineSize = (page.charsPerLine * charAdvance) / (factor > 0.05 ? factor : 0.05)
    blockSize = page.linesPerPage * lineAdvance
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)))

  return {
    flow: 'paginated',
    gap: `${page.gap}%`,
    margin: `${Math.round(page.margin)}px`,
    'max-inline-size': `${clamp(inlineSize, 120, 8000)}px`,
    'max-block-size': `${clamp(blockSize, 120, 8000)}px`,
    'max-column-count': String(blockCount),
  }
}

// 組式を変更しても再読込が必須かどうか (組方向が変わるとき)。
export const requiresReload = (a, b) =>
  !isPlainObject(a) || !isPlainObject(b)
  || a.writingMode !== b.writingMode
  || a.direction !== b.direction
