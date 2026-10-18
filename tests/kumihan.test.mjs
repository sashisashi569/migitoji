import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  normalizeSpec, defaultSpec, validateSpec, mergeSpec, JSON_SCHEMA,
  SPEC_VERSION, WRITING_MODES,
} from '../src/kumihan/spec.js'
import { buildCSS, toRenderOptions, requiresReload } from '../src/kumihan/css.js'
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

test('customCSS は末尾にそのまま付与される', () => {
  const { spec } = normalizeSpec({ customCSS: 'body { color: red; }' })
  assert.match(buildCSS(spec), /body \{ color: red; \}/)
})

test('toRenderOptions が見開き/単ページを max-column-count へ写す', () => {
  const single = toRenderOptions(normalizeSpec({ page: { spread: 'single', columnCount: 2 } }).spec)
  assert.equal(single['max-column-count'], '1')
  const spread = toRenderOptions(normalizeSpec({ page: { spread: 'spread', columnCount: 2 } }).spec)
  assert.equal(spread['max-column-count'], '2')
  const auto = toRenderOptions(normalizeSpec({ page: { spread: 'auto', columnCount: 2 } }).spec)
  assert.equal(auto['max-column-count'], '2')
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

test('requiresReload は組方向の変化のみ true', () => {
  const a = normalizeSpec({ writingMode: 'vertical-rl' }).spec
  const b = normalizeSpec({ writingMode: 'horizontal-tb' }).spec
  const c = normalizeSpec({ writingMode: 'vertical-rl', font: { size: 20 } }).spec
  assert.equal(requiresReload(a, b), true)
  assert.equal(requiresReload(a, c), false)
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
