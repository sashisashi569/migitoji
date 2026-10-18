// 組式 JSON の入出力と永続化 (ブラウザ専用)。
import { normalizeSpec, JSON_SCHEMA } from './spec.js'
import { resolvePreset, getPreset } from './presets.js'

const STORAGE_KEY = 'migitoji.kumihan.v1'

export const serializeSpec = spec => JSON.stringify(spec, null, 2)

export const parseKumihan = text => {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`JSON の解析に失敗しました: ${e.message}`)
  }
  if (Array.isArray(data)) {
    if (!data.length) throw new Error('空の配列は読み込めません')
    const warnings = data.length > 1 ? ['複数の組式のうち先頭のみ読み込みます'] : []
    return { spec: toSpec(data[0]).spec, warnings }
  }
  return toSpec(data)
}

const toSpec = data => {
  const fromPreset = resolvePreset(data)
  if (fromPreset) return { spec: fromPreset, warnings: [] }
  return normalizeSpec(data)
}

export const loadStoredSpec = () => {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return null
    return parseKumihan(text).spec
  } catch (e) {
    console.warn('保存された組式の読み込みに失敗しました', e)
    return null
  }
}

export const storeSpec = spec => {
  try {
    localStorage.setItem(STORAGE_KEY, serializeSpec(spec))
  } catch (e) {
    console.warn('組式の保存に失敗しました', e)
  }
}

export const downloadSpec = (spec, filename = `${spec.id || 'kumihan'}.json`) => {
  const blob = new Blob([serializeSpec(spec)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const readFileAsText = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error ?? new Error('ファイルの読み込みに失敗しました'))
  reader.readAsText(file)
})

export const downloadJSON = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const fetchPresetIndex = async url => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export { JSON_SCHEMA, getPreset }
