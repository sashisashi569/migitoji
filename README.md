# 概要

**migitoji** は、組式（くみしき）を JSON でカスタマイズできる、縦書き・見開き対応の日本向け電子書籍リーダーです。

[foliate-js](https://github.com/johnfactotum/foliate-js) を git submodule として参照し、日本の書籍の組版（字詰め・行数・柱・ノンブル・余白・外枠・見出し）に沿ったページ表示を行います。ビルド不要のネイティブ ES Modules で構成し、Nix devshell によるセルフホスト環境と GitHub Pages 配信に対応しています。

## 主な機能

- **組式のカスタマイズ / インポート**: 組式を JSON で定義・入出力。`presets/schema.json`（JSON Schema）付き。
- **内蔵プリセット**: 日本の出版社・判型の組版を参考にした 15 種類（文庫／新書／四六判／A5／各社文庫風 など）。
- **縦書き・横書き**: 組方向に応じて、字詰め＝1行の字数、行数＝行が積まれる方向を正しく写像。
- **綴じ方向**: 組方向（文字送り）と独立に紙の向き（縦綴じ／横綴じ）を指定。縦綴じのまま横書きにできる。
- **見開き / 単ページ**: 綴り方向（右綴じ／左綴じ）に追従して切替。
- **紙モデル**: 本文は組式サイズで固定し、余白は外側に広がる「紙」として描画（本文が潰れない）。
- **小画面への自動フィット**: 画面に収まらない場合は、字詰め・行数を保ったまま寸法を比例縮小して組み直し（一面あたりの文字数・行数は不変）。
- **見出しサイズ**: h1〜h6 の本文比サイズを組式で指定。行ボックスを整数行に揃えて行グリッドに乗せるため、見出しのある面でも行数がずれない。
- **柱・ノンブル**: 章ラベル／ページ番号の位置（上・下、寄せ）を単ページ／見開き別に指定。
- **カラーテーマ**: 本文テーマ（自動／ライト／ダーク／セピア／カスタム）と UI テーマ（自動／ライト／ダーク）を独立に設定。
- **挿絵ズーム**: 挿絵をクリック／タップすると、ブラウザ表示領域に合わせて拡大表示。
- **ページ送り領域**: 本文・paper 面・余白のいずれをクリックしても、`main#view` 基準の左右 25% で送り／戻し。
- **プログレスバー**: 綴り方向と連動し、目次の章ごとのチェックポイント（仕切り線、深さで大きさ変化）を表示。
- **目次・進捗表示・キーボード操作**。

対応形式は foliate-js に準じます（EPUB / MOBI / KF8 (AZW3) / FB2 / CBZ / PDF※）。※PDF は実験的。

## 動作環境

- Node.js 20 以上（開発サーバー・ビルド・テスト）
- Nix（`flake.nix` の devShell を利用）
- GitHub Pages などの静的配信サービス

# 使用方法

## 開く

1. ブラウザで[開く](https://sashisashi569.github.io/migitoji/)。
2. 電子書籍ファイルをドラッグ＆ドロップ、または「ファイルを選択」で開く。

## 操作

- ページ送り／戻し: 左右のナビゲーションボタン、閲覧ウィンドウの左右 25% をクリック／タップ（余白・paper 面含む）。
- キーボード: `←`/`→`（綴り方向に追従）、`j`/`k`、`Space`/`Shift+Space`、`PageUp`/`PageDown`、`Home`/`End`。
- 挿絵: クリック／タップで拡大（`Esc` または外側クリックで閉じる）。
- 表示設定: ツールバー右の設定ボタン（組式プリセット、組方向、見開き、書体、見出し、余白・外枠、柱・ノンブル、カラーテーマ、JSON）。

## 組式（Kumihan）のカスタマイズ

組式は JSON で定義します。設定パネルの「組式 JSON」から読み込み／適用／書き出し／コピーができます。`preset` にプリセット ID を書くと差分適用されます。

```jsonc
{
  "preset": "bunko-vertical",       // プリセットを土台にする場合
  "name": "マイ組式",
  "writingMode": "vertical-rl",     // 文字送り方向: vertical-rl | vertical-lr | horizontal-tb
  "binding": "auto",                // 紙の向き: auto | vertical (縦綴じ/縦長) | horizontal (横綴じ/横長)
  "font":   { "size": 15, "lineHeight": 1.7, "letterSpacing": 0.02, "family": "..." },
  "page": {
    "charsPerLine": 40,             // 字詰め（1行の字数）
    "linesPerPage": 16,             // 行数（行が積まれる方向）
    "margin": 44,                   // 柱/ノンブル帯
    "gap": 7,                       // 段間（%）
    "inset": 28,                    // 余白（本文の外側に広がる）
    "spread": "auto",               // auto | spread | single
    "frame": { "enabled": false, "width": 1, "color": null, "style": "solid", "radius": 0 }
  },
  "heading": {                      // 見出し (h1〜h6) の本文比サイズ
    "enabled": true,                // 行グリッドに乗せる（余白0・行ボックスを整数行に）
    "sizes": [2, 1.5, 1.3, 1.15, 1, 1]
  },
  "runningHead": {                  // 章ラベルの位置（単ページ/見開き別）
    "enabled": true,
    "single": { "slot": "head", "align": "end" },
    "spread": { "slot": "head", "align": "center" }
  },
  "pageNumber": {                   // ページ番号の位置
    "enabled": true,
    "single": { "slot": "foot", "align": "center" },
    "spread": { "slot": "foot", "align": "center" }
  },
  "colors": { "theme": "auto" }     // auto | light | dark | sepia | custom
}
```

- `binding` は紙の向きを決めます。`auto`（既定）は組方向に追従（縦組み=縦綴じ／横組み=横綴じ）。`vertical` にすると紙を縦長（縦綴じ）のまま文字送り方向だけ切り替えられます（横書き書籍など）。紙の寸法は、同じ `charsPerLine`／`linesPerPage` の縦組みと同じになります。
- スキーマ: [`presets/schema.json`](./presets/schema.json)
- 全プリセット: [`presets/index.json`](./presets/index.json)
- 記述例: [`presets/example-custom.json`](./presets/example-custom.json), [`presets/example-preset-diff.json`](./presets/example-preset-diff.json)

## 内蔵プリセット

| ID | 名称 | 組方向 |
|---|---|---|
| `bunko-vertical` | 文庫判 | 縦 |
| `shinsho-vertical` | 新書判 | 縦 |
| `tankobon-46-vertical` | 単行本（四六判） | 縦 |
| `a5-vertical` | A5判 | 縦 |
| `iwanami-bunko` | 岩波文庫風 | 縦 |
| `kodansha-bunko` | 講談社文庫風 | 縦 |
| `shincho-bunko` | 新潮文庫風 | 縦 |
| `kadokawa-bunko` | 角川文庫風 | 縦 |
| `chikuma-bunko` | ちくま文庫風 | 縦 |
| `chuokoron-shinsho` | 中公新書風 | 縦 |
| `aozora-vertical` | 青空文庫風 | 縦 |
| `bunko-sepia-frame` | 文庫判・セピア枠付き | 縦 |
| `bunko-horizontal` | 文庫判 | 横 |
| `web-novel-horizontal` | Web小説 | 横 |
| `technical-horizontal` | 技術書 | 横 |

> 各プリセットの数値は、判型ごとの一般的な組版慣例に基づく**参考値**です。各社の実際の組版仕様を示すものではありません。

## セルフホスト

### 取得

```sh
# submodule を含めて取得
git clone --recurse-submodules <this-repo-url> migitoji
cd migitoji
# 既に clone 済みなら
git submodule update --init --recursive
```

### Nix devshell（推奨）

```sh
nix develop        # nodejs / git / zip / migitoji-serve などが入ったシェル
npm run dev        # http://127.0.0.1:8000/ で配信
```

### Node.js を直接使う場合

```sh
npm run dev        # 依存ゼロの静的配信サーバー（scripts/serve.mjs）
```

`node_modules` は不要です（バンドラやフレームワークを使っていません）。任意の静的配信サービスでも、リポジトリのルートをそのまま配信すれば動作します。

# 開発

## ディレクトリ構成

```
.
├── index.html            # アプリのシェル（CSP 付き）
├── src/
│   ├── main.js           # エントリ
│   ├── reader.js         # foliate-view のラップ（組式適用・柱/ノンブル・挿絵・ページ送り）
│   ├── styles.css        # UI スタイル（UI カラーテーマ・紙モデル・ライトボックス）
│   ├── kumihan/
│   │   ├── spec.js       # 組式スキーマ・正規化・検証・JSON Schema
│   │   ├── css.js        # 組式 → 本文CSS / paginator 属性への写像
│   │   ├── presets.js    # 内蔵プリセット
│   │   └── io.js         # JSON 入出力・永続化
│   └── ui/app.js         # UI シェル・設定パネル・目次・進捗・テーマ
├── presets/              # 生成物（index.json / schema.json / 例）
├── scripts/              # 配信・ビルド・プリセット生成・サンプル生成・ブラウザスモーク
├── tests/                # 単体テスト・fixtures
├── vendor/foliate-js/    # git submodule
├── flake.nix             # Nix devshell / package
└── .github/workflows/pages.yml
```

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 静的配信サーバーを起動（既定 `http://127.0.0.1:8000/`） |
| `npm test` | 組式スキーマ／CSS 写像の単体テスト（Node の組込みテスト） |
| `npm run build` | `dist/` を生成（GitHub Pages 用） |
| `npm run gen:presets` | プリセットと JSON Schema を `presets/` へ書き出し |
| `npm run make:sample` | テスト用 EPUB を生成（`tests/fixtures/sample.epub`） |
| `npm run smoke` | Firefox（WebDriver BiDi）で実描画スモークテスト。`--mobile` / `--viewport WxH --dpr N` でスマホ相当を検証 |

## セキュリティ

EPUB はスクリプトを含み得るため、`index.html` に CSP（`default-src 'self' blob: data:` ほか、`script-src 'self'`）を設定しています。信頼できない書籍を扱う場合は必ず CSP を有効にしたまま使用してください（foliate-js の注意事項に準じます）。

# ライセンス

- 本プロジェクト: [MIT](./LICENSE)
- [foliate-js](https://github.com/johnfactotum/foliate-js)（submodule）: MIT
  - 同梱ライブラリ: zip.js（BSD-3-Clause）、fflate（MIT）、PDF.js（Apache-2.0）
