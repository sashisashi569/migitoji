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

test('行数は横組みでは max-block-size、縦組みでは max-inline-size に写る', () => {
  // gap 0 なら gap 補正が無いので値がそのまま読める
  const common = {
    writingMode: 'horizontal-tb',
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 10, charsPerLine: 15, gap: 0, spread: 'single' },
  }
  // 行送り = 20*2 = 40 → 10行 = 400px / 字詰め = 15字 × 20px = 300px
  const h = toRenderOptions(normalizeSpec(common).spec)
  assert.equal(h['max-block-size'], '400px', '横組み: 行数→高さ')
  assert.equal(h['max-inline-size'], '300px', '横組み: 字詰め→幅')

  const v = toRenderOptions(normalizeSpec({ ...common, writingMode: 'vertical-rl' }).spec)
  // 縦組みは行数が面の幅（= max-inline-size）になる
  assert.equal(v['max-inline-size'], '400px', '縦組み: 行数→幅')
  // 単ページのときコンテナ幅 = 1面の幅 = 行数×行送り
  assert.equal(v['max-block-size'], '400px', '縦組み: 単ページのコンテナ幅')
})

test('縦組みはコンテナ幅の設定で見開き/単ページを切り替える', () => {
  const base = {
    writingMode: 'vertical-rl',
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 10, charsPerLine: 15, gap: 10 },
  }
  const single = toRenderOptions(normalizeSpec({ ...base, page: { ...base.page, spread: 'single' } }).spec)
  const spread = toRenderOptions(normalizeSpec({ ...base, page: { ...base.page, spread: 'spread', columnCount: 2 } }).spec)
  // gap 補正: g=0.1, h=0.1/0.9≈0.1111
  // 1面幅 = 10*40 = 400, inline = 400/(1-h) = 450
  assert.equal(single['max-inline-size'], '450px')
  assert.equal(single['max-block-size'], '400px', '単ページ: 1面ぶんの幅')
  // 見開き = 2列ぶん = inline*(2-h) = 450*1.8889 = 850
  assert.equal(spread['max-block-size'], '850px', '見開き: 2面ぶんの幅')
  assert.equal(spread['max-inline-size'], single['max-inline-size'], '面の高さは不変')
  assert.ok(parseFloat(spread['max-block-size']) > parseFloat(single['max-block-size']))
})

test('縦組みの段数 (verticalColumns) で面高が変わり行数は維持される', () => {
  const base = {
    writingMode: 'vertical-rl',
    font: { size: 20, lineHeight: 2, letterSpacing: 0 },
    page: { linesPerPage: 10, charsPerLine: 20, gap: 10, spread: 'single' },
  }
  const d1 = toRenderOptions(normalizeSpec({ ...base, page: { ...base.page, verticalColumns: 1 } }).spec)
  const d2 = toRenderOptions(normalizeSpec({ ...base, page: { ...base.page, verticalColumns: 2 } }).spec)
  const h = 0.1 / 0.9
  // 1面幅 = 10行 × 行送り40 = 400 → 単ページの幅は d に依存しない
  assert.equal(d1['max-block-size'], '400px')
  assert.equal(d2['max-block-size'], '400px')
  // 面高 = 400 / (1 - d·h)
  assert.equal(d1['max-inline-size'], `${Math.round(400 / (1 - h))}px`)
  assert.equal(d2['max-inline-size'], `${Math.round(400 / (1 - 2 * h))}px`)
  assert.ok(parseFloat(d2['max-inline-size']) > parseFloat(d1['max-inline-size']))
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
