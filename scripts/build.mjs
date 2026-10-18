#!/usr/bin/env node
// dist/ を生成する。バンドラ無しで必要なファイルをそのまま複製するだけ。
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const outArg = args.findIndex(a => a === '--out' || a === '-o')
const OUT = resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'dist')
const WITH_PDF = !args.includes('--no-pdf')

// vendor/foliate-js 内で配信不要なもの
const VENDOR_SKIP = new Set([
  '.git', '.github', 'tests', 'rollup', 'node_modules',
  'eslint.config.js', 'package-lock.json', 'package.json', 'rollup.config.js',
])

const copyDir = async (src, dest, { skip = new Set() } = {}) => {
  await fs.mkdir(dest, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) await copyDir(from, to, { skip })
    else if (entry.isFile()) await fs.copyFile(from, to)
  }
}

const copyFile = async (rel) => {
  const from = join(ROOT, rel)
  const to = join(OUT, rel)
  await fs.mkdir(dirname(to), { recursive: true })
  await fs.copyFile(from, to)
}

const main = async () => {
  await fs.rm(OUT, { recursive: true, force: true })
  await fs.mkdir(OUT, { recursive: true })

  await copyFile('index.html')
  await copyDir(join(ROOT, 'src'), join(OUT, 'src'))
  await copyDir(join(ROOT, 'presets'), join(OUT, 'presets'))

  const vendorSrc = join(ROOT, 'vendor', 'foliate-js')
  const vendorDest = join(OUT, 'vendor', 'foliate-js')
  const skip = new Set(VENDOR_SKIP)
  if (!WITH_PDF) skip.add('pdfjs')
  await copyDir(vendorSrc, vendorDest, { skip })

  // GitHub Pages (Jekyll 無効化)
  await fs.writeFile(join(OUT, '.nojekyll'), '')
  // GitHub Pages はサブパス配信のため、相対パスのみで動作させる

  const rel = relative(ROOT, OUT) || '.'
  const count = await countFiles(OUT)
  console.log(`migitoji: built ${count} files -> ${rel}/`)
}

const countFiles = async dir => {
  let n = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countFiles(join(dir, entry.name))
    else n++
  }
  return n
}

main().catch(err => { console.error(err); process.exit(1) })
