import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  normalizeSpec, defaultSpec, validateSpec, mergeSpec, JSON_SCHEMA,
  SPEC_VERSION, WRITING_MODES,
} from '../src/kumihan/spec.js'
import { buildCSS, toRenderOptions, requiresReload, resolveContentColors } from '../src/kumihan/css.js'
import { PRESETS, resolvePreset, getPreset } from '../src/kumihan/presets.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const readJSON = async p => JSON.parse(await readFile(join(ROOT, p), 'utf8'))

test('defaultSpec は正規化済み (冪等)', () => {
  const { spec } = normalizeSpec(defaultSpec())
  assert.deepEqual(spec, defaultSpec())
  assert.equal(spec.version, SPEC_VERSION)
})

test('既定値の穴埋めと範囲補正', () => {
  const { spec, warnings } = normalizeSpec({ font: { size: 999, lineHeight: 1.5 } })
  assert.equal(spec.font.size, 72, '上限へクランプ')
  assert.equal(spec.font.lineHeight, 1.5, '指定値は維持')
  assert.ok(warnings.some(w => w.includes('font.size')), '補正警告が出る')
  assert.equal(spec.writingMode, 'vertical-rl', '未指定は既定の縦組み')
})

test('無効値は既定へフォールバックし警告を出す', () => {
  const { spec, warnings } = normalizeSpec({ writingMode: 'diagonal' })
  assert.equal(spec.writingMode, 'vertical-rl')
  assert.ok(warnings.length > 0)
})

test('非オブジェクト入力でも既定値を返す', () => {
  for (const bad of [null, 42, 'x', []]) {
    const { spec } = normalizeSpec(bad)
    assert.deepEqual(spec, defaultSpec())
  }
})

test('validateSpec は致命的誤りを検出する', () => {
  assert.equal(validateSpec({ writingMode: 'nope' }).valid, false)
  assert.equal(validateSpec({ page: 5 }).valid, false)
  assert.equal(validateSpec({ writingMode: 'vertical-rl', page: {} }).valid, true)
  assert.equal(validateSpec('x').valid, false)
})

test('mergeSpec はネストを保ってマージし配列は置換する', () => {
  const base = { a: 1, font: { size: 10, family: 'x' }, fonts: [1, 2] }
  const out = mergeSpec(base, { font: { size: 20 }, fonts: [3] })
  assert.deepEqual(out, { a: 1, font: { size: 20, family: 'x' }, fonts: [3] })
})

test('buildCSS が組方向と本文スタイルを出力する', () => {
  const { spec } = normalizeSpec({
    writingMode: 'vertical-rl',
    font: { family: 'Test', size: 18, lineHeight: 2, letterSpacing: 0.05 },
    colors: { background: '#eee', color: '#111' },
  })
  const css = buildCSS(spec)
  assert.match(css, /writing-mode:\s*vertical-rl\s*!important/)
  assert.match(css, /font-size:\s*18px/)
  assert.match(css, /line-height:\s*2/)
  assert.match(css, /letter-spacing:\s*0\.05em/)
  assert.match(css, /background:\s*#eee\s*!important/)
  // @font-face も生成される
  const withFont = buildCSS({ ...spec, fonts: [{ family: 'Custom', src: "url('a.woff2')" }] })
  assert.match(withFont, /@font-face/)
  assert.match(withFont, /font-family: "Custom"/)
})

test('direction: 横組みは LTR を既定にし、明示指定は尊重する', () => {
  // 横組みは書籍の page-progression-direction に引きずられないよう LTR を明示する
  assert.match(buildCSS(normalizeSpec({ writingMode: 'horizontal-tb' }).spec), /direction:\s*ltr\s*!important/)
  assert.match(buildCSS(normalizeSpec({ writingMode: 'horizontal-tb', direction: 'rtl' }).spec), /direction:\s*rtl\s*!important/)
  // 縦組みは明示指定が無ければ direction を出力しない
  assert.doesNotMatch(buildCSS(normalizeSpec({ writingMode: 'vertical-rl' }).spec), /direction:\s*(ltr|rtl)/)
  assert.match(buildCSS(normalizeSpec({ writingMode: 'vertical-rl', direction: 'rtl' }).spec), /direction:\s*rtl\s*!important/)
})

test('customCSS は末尾にそのまま付与される', () => {
  const { spec } = normalizeSpec({ customCSS: 'body { color: red; }' })
  assert.match(buildCSS(spec), /body \{ color: red; \}/)
})

test('見出しサイズ設定が正規化され CSS に反映される', () => {
  const { spec } = normalizeSpec({ heading: { enabled: true, sizes: [2.5, 2, 1.5, 1, 1, 1] } })
  assert.deepEqual(spec.heading.sizes, [2.5, 2, 1.5, 1, 1, 1])
  const css = buildCSS(spec)
  assert.match(css, /h1 \{\s*font-size: 2\.5em/)
  assert.match(css, /h1 \{[\s\S]*?margin: 0/)
  // 行ボックスは行送りの整数倍 (h1 2.5em, lineHeight 1.7 -> 2行 = 3.4em -> line-height 1.36)
  assert.match(css, /h1 \{[\s\S]*?line-height: 1\.36/)

  // 既定値 (見出しサイズ h1〜h6)
  const def = buildCSS(normalizeSpec({}).spec)
  assert.match(def, /h1 \{\s*font-size: 2em/)
  assert.match(def, /h6 \{\s*font-size: 1em/)

  // enabled:false では見出し正規化を出力しない
  const off = buildCSS(normalizeSpec({ heading: { enabled: false } }).spec)
  assert.doesNotMatch(off, /h1 \{\s*font-size:/)
})

test('見開き: 縦組みは段数を増やさず面を広げ、横組みは2段', () => {
  const page = { columnCount: 2, gap: 0 }
  const single = toRenderOptions(normalizeSpec({ page: { ...page, spread: 'single' } }).spec)
  const spread = toRenderOptions(normalizeSpec({ page: { ...page, spread: 'spread' } }).spec)
  // 縦組み: 段数は1のまま、行数方向(max-block-size)が倍、字詰め方向(max-inline-size)は不変
  assert.equal(single['max-column-count'], '1')
  assert.equal(spread['max-column-count'], '1', '縦組みの見開きは段数を増やさない')
  assert.ok(Math.abs(parseFloat(spread['max-block-size']) - parseFloat(single['max-block-size']) * 2) <= 2)
  assert.equal(spread['max-inline-size'], single['max-inline-size'])
  // 横組み: 見開きは2段 (max-column-count=2)、行数方向は不変
  const hSingle = toRenderOptions(normalizeSpec({ writingMode: 'horizontal-tb', page: { ...page, spread: 'single' } }).spec)
  const hSpread = toRenderOptions(normalizeSpec({ writingMode: 'horizontal-tb', page: { ...page, spread: 'spread' } }).spec)
  assert.equal(hSingle['max-column-count'], '1')
  assert.equal(hSpread['max-column-count'], '2', '横組みの見開きは2段')
  assert.equal(hSpread['max-block-size'], hSingle['max-block-size'])
  assert.equal(normalizeSpec({}).spec.page.spread, 'spread', '既定は見開き')
  assert.equal(spread.gap.endsWith('%'), true)
  assert.equal(spread.margin.endsWith('px'), true)
})

test('字詰め→max-inline-size / 行数→max-block-size (両組方向で同じ)', () => {
  // gap 0 なら gap 補正が無く値がそのまま読める
  const common = {
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 10, charsPerLine: 15, gap: 0, spread: 'single' },
  }
  // 字詰め = 15字 × 20px = 300px / 行数 = 10行 × 行送り40 = 400px
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const o = toRenderOptions(normalizeSpec({ ...common, writingMode }).spec)
    assert.equal(o['max-inline-size'], '300px', `${writingMode}: 字詰め→max-inline-size`)
    assert.equal(o['max-block-size'], '400px', `${writingMode}: 行数→max-block-size`)
  }
})

test('縦組みは max-block-size(行数方向の幅) で見開き/単ページを切り替える', () => {
  const base = {
    writingMode: 'vertical-rl',
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 10, charsPerLine: 15, gap: 0 },
  }
  const single = toRenderOptions(normalizeSpec({ ...base, page: { ...base.page, spread: 'single' } }).spec)
  const spread = toRenderOptions(normalizeSpec({ ...base, page: { ...base.page, spread: 'spread', columnCount: 2 } }).spec)
  assert.equal(single['max-block-size'], '400px', '単ページ: 1面ぶんの幅')
  assert.equal(spread['max-block-size'], '800px', '見開き: 2面ぶんの幅')
  assert.equal(single['max-inline-size'], spread['max-inline-size'], '面の長さ(字詰め)は不変')
})

test('gap があると段幅ぶんを補正する', () => {
  const withGap = toRenderOptions(normalizeSpec({
    writingMode: 'vertical-rl',
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 10, charsPerLine: 15, gap: 10, spread: 'single' },
  }).spec)
  // 面の長さ = 300 / (1 - h) > 300
  assert.ok(parseFloat(withGap['max-inline-size']) > 300)
})

test('binding は既定 auto、無効値は auto へフォールバック', () => {
  assert.equal(normalizeSpec({}).spec.binding, 'auto')
  assert.equal(normalizeSpec({ binding: 'vertical' }).spec.binding, 'vertical')
  assert.equal(normalizeSpec({ binding: 'horizontal' }).spec.binding, 'horizontal')
  const { spec, warnings } = normalizeSpec({ binding: 'diagonal' })
  assert.equal(spec.binding, 'auto')
  assert.ok(warnings.some(w => w.includes('binding')))
})

test('縦綴じ + 横組み は紙の向きを変えず文字送りだけ横にする', () => {
  // gap 0 / 字詰め20字(A=400px) × 行数5行(B=200px) → 紙は縦長。
  const common = {
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 5, charsPerLine: 20, gap: 0, spread: 'single' },
  }
  const vertical = toRenderOptions(normalizeSpec({ ...common, writingMode: 'vertical-rl' }).spec)
  const horizontal = toRenderOptions(normalizeSpec({ ...common, writingMode: 'horizontal-tb' }).spec)
  const portraitH = toRenderOptions(normalizeSpec({
    ...common, writingMode: 'horizontal-tb', binding: 'vertical',
  }).spec)

  // 自然な向き: 縦組みは紙=縦長 (幅=block 200 / 高さ=inline 400)、横組みは横長。
  assert.equal(vertical['max-inline-size'], '400px', '縦組みの面の長さ')
  assert.equal(vertical['max-block-size'], '200px', '縦組みの面の幅')
  assert.equal(horizontal['max-inline-size'], '400px', '横組みは字詰めが幅')
  assert.equal(horizontal['max-block-size'], '200px', '横組みは行数が高さ')

  // 縦綴じのまま横組み: 縦組みと同じ紙 (幅=200 / 高さ=400) になる。
  assert.equal(portraitH['max-inline-size'], '200px', '縦綴じ+横組み: 幅')
  assert.equal(portraitH['max-block-size'], '400px', '縦綴じ+横組み: 高さ')
})

test('横綴じ + 縦組み は横組みと同じ紙 (横長) になる', () => {
  const common = {
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 5, charsPerLine: 20, gap: 0, spread: 'single' },
  }
  const horizontal = toRenderOptions(normalizeSpec({ ...common, writingMode: 'horizontal-tb' }).spec)
  const landscapeV = toRenderOptions(normalizeSpec({
    ...common, writingMode: 'vertical-rl', binding: 'horizontal',
  }).spec)
  assert.equal(landscapeV['max-inline-size'], horizontal['max-block-size'], '縦組み+横綴じ: 面の長さ=高さ')
  assert.equal(landscapeV['max-block-size'], horizontal['max-inline-size'], '縦組み+横綴じ: 面の幅=幅')
})

test('requiresReload は組方向・綴じ方向の変化で true', () => {
  const a = normalizeSpec({ writingMode: 'vertical-rl' }).spec
  const b = normalizeSpec({ writingMode: 'horizontal-tb' }).spec
  const c = normalizeSpec({ writingMode: 'vertical-rl', font: { size: 20 } }).spec
  const d = normalizeSpec({ writingMode: 'vertical-rl', binding: 'horizontal' }).spec
  assert.equal(requiresReload(a, b), true)
  assert.equal(requiresReload(a, c), false)
  assert.equal(requiresReload(a, d), true, '綴じ方向の変化も再読込')
})

test('縦綴じのままなら組方向を変えても紙の向きは縦長のまま', () => {
  const { spec } = normalizeSpec({
    font: { size: 15, lineHeight: 1.7, letterSpacing: 0.02 },
    page: { margin: 44, gap: 7, charsPerLine: 40, linesPerPage: 16, spread: 'single' },
  })
  const vertical = toRenderOptions({ ...spec, writingMode: 'vertical-rl', binding: 'auto' })
  const horizontal = toRenderOptions({ ...spec, writingMode: 'horizontal-tb', binding: 'vertical' })
  // どちらも紙は縦長 (横組み側は幅 < 高さ)。
  assert.equal(horizontal['max-inline-size'], vertical['max-block-size'], '横組みの幅=縦組みの紙幅')
  assert.equal(horizontal['max-block-size'], vertical['max-inline-size'], '横組みの高さ=縦組みの紙高')
})

test('新要素(テーマ/余白/外枠/柱位置)を正規化できる', () => {
  const { spec } = normalizeSpec({
    colors: { theme: 'dark' },
    page: { inset: 12, frame: { enabled: true, width: 3, style: 'double' } },
    runningHead: { single: { slot: 'foot', align: 'end' }, spread: { slot: 'head', align: 'start' } },
    pageNumber: { enabled: false },
  })
  assert.equal(spec.colors.theme, 'dark')
  assert.equal(spec.page.inset, 12)
  assert.deepEqual(spec.page.frame, { enabled: true, width: 3, color: null, style: 'double', radius: 0 })
  assert.deepEqual(spec.runningHead.single, { slot: 'foot', align: 'end' })
  assert.deepEqual(spec.runningHead.spread, { slot: 'head', align: 'start' })
  assert.equal(spec.pageNumber.enabled, false)
})

test('不正なテーマ/スロットは既定へフォールバック', () => {
  const { spec } = normalizeSpec({ colors: { theme: 'neon' }, runningHead: { single: { slot: 'left' } } })
  assert.equal(spec.colors.theme, 'auto')
  assert.equal(spec.runningHead.single.slot, 'head')
  assert.equal(spec.runningHead.single.align, 'center')
})

test('resolveContentColors がテーマと上書きを解決する', () => {
  assert.equal(resolveContentColors({ colors: { theme: 'auto' } }).background, null)
  const sepia = resolveContentColors({ colors: { theme: 'sepia' } })
  assert.equal(sepia.background, '#f4ecd8')
  assert.equal(sepia.colorScheme, 'light')
  const custom = resolveContentColors({ colors: { theme: 'dark', background: '#000000' } })
  assert.equal(custom.background, '#000000')
  assert.equal(custom.color, '#d8d3c8')
  assert.equal(custom.colorScheme, 'dark')

  // buildCSS にも反映される
  const css = buildCSS(normalizeSpec({ colors: { theme: 'dark' } }).spec)
  assert.match(css, /background:\s*#121417\s*!important/)
  assert.match(css, /color-scheme:\s*dark/)
})

test('内蔵プリセットは一意で正規化済み', () => {
  const ids = new Set()
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id), `id 重複: ${p.id}`)
    ids.add(p.id)
    assert.ok(WRITING_MODES.includes(p.writingMode), `${p.id} の組方向`)
    assert.deepEqual(normalizeSpec(p).spec, p, `${p.id} は正規化済み`)
  }
})

test('presets/index.json は PRESETS と一致する', async () => {
  const index = await readJSON('presets/index.json')
  assert.deepEqual(index, PRESETS)
})

test('presets/schema.json は JSON_SCHEMA と一致する', async () => {
  const schema = await readJSON('presets/schema.json')
  assert.deepEqual(schema, JSON_SCHEMA)
})

test('preset 差分指定を解決できる', async () => {
  const diff = await readJSON('presets/example-preset-diff.json')
  const spec = resolvePreset(diff)
  assert.ok(spec)
  assert.equal(spec.id, 'shincho-bunko-large')
  assert.equal(spec.font.size, 19)
  const base = getPreset('shincho-bunko')
  assert.equal(spec.font.family, base.font.family, '土台の値を引き継ぐ')
  assert.equal(spec.font.lineHeight, 1.9)
})

test('フル記述の組式 example を正規化できる', async () => {
  const full = await readJSON('presets/example-custom.json')
  assert.equal(validateSpec(full).valid, true)
  const { spec } = normalizeSpec(full)
  assert.equal(spec.id, 'night-reading')
  assert.equal(spec.colors.background, '#f4ecd8')
})
