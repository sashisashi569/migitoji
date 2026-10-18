#!/usr/bin/env node
// 内蔵プリセットと JSON Schema を presets/ へ書き出す。
// presets.js を単一の情報源として保つための生成スクリプト。
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { PRESETS } from '../src/kumihan/presets.js'
import { JSON_SCHEMA } from '../src/kumihan/spec.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = join(ROOT, 'presets')

await fs.mkdir(OUT, { recursive: true })
await fs.writeFile(join(OUT, 'index.json'), JSON.stringify(PRESETS, null, 2) + '\n')
await fs.writeFile(join(OUT, 'schema.json'), JSON.stringify(JSON_SCHEMA, null, 2) + '\n')
console.log(`wrote ${PRESETS.length} presets and schema -> presets/`)
