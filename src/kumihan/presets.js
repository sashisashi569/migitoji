// 日本の出版社・書籍判型の組式を参考にした内蔵プリセット。
//
// 注意: 各社の実際の組版仕様は非公開であり、本書は「〜風」の参考値である。
// 判型ごとの一般的な字詰め・行送り・余白の慣例に基づいて構成している。
//
// page.charsPerLine / page.linesPerPage が組式の「字詰め × 行数」にあたる。
// 横組みでは行数が高さ、縦組みでは行数が幅として組版される (css.js を参照)。
import { normalizeSpec, defaultSpec, mergeSpec } from './spec.js'

// 判型ごとの基準値:
//   font.size=px, font.letterSpacing=em, font.lineHeight=倍, page.margin=px,
//   page.charsPerLine=字, page.linesPerPage=行
const PRESET_SOURCES = [
  {
    id: 'bunko-vertical',
    name: '文庫判（縦組み）',
    description: 'A6 文庫サイズの標準的な縦組み。字詰め40字・16行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.7, letterSpacing: 0.02 },
    page: { margin: 44, gap: 7, charsPerLine: 40, linesPerPage: 16, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'shinsho-vertical',
    name: '新書判（縦組み）',
    description: '新書サイズの縦組み。字詰め40字・17行で可読性を確保。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.72, letterSpacing: 0.02 },
    page: { margin: 44, gap: 8, charsPerLine: 40, linesPerPage: 17, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'tankobon-46-vertical',
    name: '単行本（四六判・縦組み）',
    description: '四六判単行本の縦組み。字詰め42字・17行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 16, lineHeight: 1.75, letterSpacing: 0.03 },
    page: { margin: 52, gap: 7, charsPerLine: 42, linesPerPage: 17, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'a5-vertical',
    name: 'A5判（縦組み）',
    description: '実用書・学術書に多い A5 判の縦組み。字詰め43字・19行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.68, letterSpacing: 0.01 },
    page: { margin: 48, gap: 6, charsPerLine: 43, linesPerPage: 19, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'iwanami-bunko',
    name: '岩波文庫風（縦組み）',
    description: '小型・密組み・控えめな余白を特徴とする岩波文庫風の参考値。字詰め41字・16行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 14.5, lineHeight: 1.66, letterSpacing: 0.01 },
    paragraph: { indent: 1, align: 'justify', spacingBetween: 0 },
    page: { margin: 40, gap: 6, charsPerLine: 41, linesPerPage: 16, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'kodansha-bunko',
    name: '講談社文庫風（縦組み）',
    description: '大衆文芸向けに字間をやや広めに取った講談社文庫風の参考値。字詰め40字・16行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.7, letterSpacing: 0.025 },
    page: { margin: 44, gap: 7, charsPerLine: 40, linesPerPage: 16, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'shincho-bunko',
    name: '新潮文庫風（縦組み）',
    description: '行間と字間をゆったり取った新潮文庫風の参考値。字詰め40字・17行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.76, letterSpacing: 0.03 },
    page: { margin: 48, gap: 8, charsPerLine: 40, linesPerPage: 17, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'kadokawa-bunko',
    name: '角川文庫風（縦組み）',
    description: 'ライト文芸・エンタメ文庫を想定したやや大きめの角川文庫風参考値。字詰め40字・16行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15.5, lineHeight: 1.72, letterSpacing: 0.02 },
    page: { margin: 46, gap: 7, charsPerLine: 40, linesPerPage: 16, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'chikuma-bunko',
    name: 'ちくま文庫風（縦組み）',
    description: '普遍的な文庫組みを踏襲したちくま文庫風の参考値。字詰め40字・16行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.7, letterSpacing: 0.015 },
    page: { margin: 44, gap: 7, charsPerLine: 40, linesPerPage: 16, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'chuokoron-shinsho',
    name: '中公新書風（縦組み）',
    description: '新書の本文組。見出しはゴシック、本文は明朝。字詰め40字・17行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.7, letterSpacing: 0.02 },
    customCSS: `h1, h2, h3, h4, h5, h6 { font-family: 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif; }`,
    page: { margin: 46, gap: 7, charsPerLine: 40, linesPerPage: 17, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'aozora-vertical',
    name: '青空文庫風（縦組み・簡素）',
    description: '余計な装飾を排した最小限の縦組み。字詰め40字・17行。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 16, lineHeight: 1.75, letterSpacing: 0.02, features: '' },
    paragraph: { indent: 1, align: 'justify', hangingPunctuation: 'allow-end last' },
    punctuation: { hanging: true, trimStart: false, trimEnd: false, autospace: 'normal' },
    page: { margin: 48, gap: 8, charsPerLine: 40, linesPerPage: 17, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'bunko-sepia-frame',
    name: '文庫判・セピア枠付き',
    description: '余白・外枠・カラーテーマ・柱位置を定義した例。字詰め40字・16行の縦組み。',
    writingMode: 'vertical-rl',
    font: { family: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif", size: 15, lineHeight: 1.7, letterSpacing: 0.02 },
    colors: { theme: 'sepia' },
    page: {
      margin: 44, gap: 7, charsPerLine: 40, linesPerPage: 16, columnCount: 2, spread: 'auto',
      inset: 20,
      frame: { enabled: true, width: 2, color: '#b8a06a', style: 'solid', radius: 6 },
    },
    runningHead: {
      enabled: true,
      single: { slot: 'head', align: 'end' },
      spread: { slot: 'head', align: 'center' },
    },
    pageNumber: {
      enabled: true,
      single: { slot: 'foot', align: 'center' },
      spread: { slot: 'foot', align: 'center' },
    },
  },
  {
    id: 'bunko-horizontal',
    name: '文庫判（横組み）',
    description: '横組みで読む場合の文庫サイズ。字詰め45字・18行。行数は高さに対応。',
    writingMode: 'horizontal-tb',
    font: { family: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif", size: 15, lineHeight: 1.7, letterSpacing: 0.01 },
    paragraph: { indent: 1, align: 'justify' },
    page: { margin: 48, gap: 7, charsPerLine: 45, linesPerPage: 18, columnCount: 2, spread: 'auto' },
  },
  {
    id: 'web-novel-horizontal',
    name: 'Web小説（横組み）',
    description: '画面読書に最適化したゴシック体・広めの行間・字下げなし。字詰め42字・22行。',
    writingMode: 'horizontal-tb',
    font: { family: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif", size: 17, lineHeight: 1.85, letterSpacing: 0, features: '' },
    paragraph: { indent: 0, align: 'start', lineBreak: 'normal', spacingBetween: 0.8, hangingPunctuation: 'none' },
    punctuation: { hanging: false, autospace: 'none' },
    page: { margin: 40, gap: 6, charsPerLine: 42, linesPerPage: 22, columnCount: 1, spread: 'single' },
  },
  {
    id: 'technical-horizontal',
    name: '技術書（横組み）',
    description: 'コードや欧文を多く含む書籍向け。等幅フォントと控えめな字下げ。字詰め50字・24行。',
    writingMode: 'horizontal-tb',
    font: { family: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', system-ui, sans-serif", size: 16, lineHeight: 1.7, letterSpacing: 0, kerning: true },
    paragraph: { indent: 0, align: 'start', lineBreak: 'normal', spacingBetween: 0.6, hangingPunctuation: 'none' },
    punctuation: { hanging: false, autospace: 'none' },
    customCSS: `code, kbd, samp, pre { font-family: 'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace; font-size: .95em; }`,
    page: { margin: 48, gap: 6, charsPerLine: 50, linesPerPage: 24, columnCount: 2, spread: 'auto' },
  },
]

// 既定値へ差分をマージして正規化したプリセット一覧。
export const PRESETS = PRESET_SOURCES.map(src => {
  const merged = mergeSpec(defaultSpec(), src)
  const { spec } = normalizeSpec(merged)
  return spec
})

export const PRESET_IDS = PRESETS.map(p => p.id)

export const getPreset = id => PRESETS.find(p => p.id === id) ?? null

// 単体の組式 JSON をプリセットへ解決する。
// `preset: "bunko-vertical"` だけを持つ場合はプリセットを土台に差分適用する。
export const resolvePreset = input => {
  if (!input || typeof input !== 'object') return null
  const base = input.preset ? getPreset(input.preset) : null
  const { preset: _preset, ...rest } = input
  if (base) return normalizeSpec(mergeSpec(base, rest)).spec
  return null
}
