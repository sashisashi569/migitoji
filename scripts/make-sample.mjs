#!/usr/bin/env node
// テスト用の最小 EPUB を生成する (ZIP の store 方式で外部依存なし)。
// 出力: tests/fixtures/sample.epub
import { promises as fs } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc = buf => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()

const makeZip = (files, { compress = true } = {}) => {
  const chunks = []
  const central = []
  let offset = 0

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name)
    const data = typeof content === 'string' ? enc.encode(content) : content
    const store = !compress || name === 'mimetype'
    const method = store ? 0 : 8
    const body = store ? data : new Uint8Array(deflateRawSync(data))
    const c = crc(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(c, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, Buffer.from(nameBytes), Buffer.from(body))

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(c, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, Buffer.from(nameBytes))

    offset += local.length + nameBytes.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, eocd])
}

const paras = n => Array.from({ length: n }, (_, i) =>
  `<p>これは組式を確認するための本文です。第${i + 1}段落。縦書きの行送り、字間、禁則処理、ルビの位置などが読みやすく整っているかを確かめます。句読点、括弧「」、約物の詰めも確認します。</p>`
).join('\n')

const chapter = (title, n) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
<h1>${title}</h1>
${paras(n)}
<p><ruby>migitoji<rp>(</rp><rt>みぎとじ</rt><rp>)</rp></ruby> の動作確認。</p>
</body></html>`

const files = [
  ['mimetype', 'application/epub+zip'],
  ['META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
  ['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:migitoji-sample</dc:identifier>
    <dc:title>組式確認サンプル</dc:title>
    <dc:language>ja</dc:language>
    <dc:creator>migitoji</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`],
  ['OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head><meta charset="utf-8"/><title>目次</title></head>
<body><nav epub:type="toc"><h1>目次</h1><ol>
<li><a href="chapter1.xhtml">一章 組式の確認</a></li>
<li><a href="chapter2.xhtml">二章 見開きの確認</a></li>
</ol></nav></body></html>`],
  ['OEBPS/chapter1.xhtml', chapter('一章 組式の確認', 14)],
  ['OEBPS/chapter2.xhtml', chapter('二章 見開きの確認', 14)],
]

const out = new URL('../tests/fixtures/sample.epub', import.meta.url)
await fs.mkdir(new URL('.', out), { recursive: true })
const buf = makeZip(files)
await fs.writeFile(out, buf)
console.log(`wrote ${out.pathname} (${buf.length} bytes)`)
