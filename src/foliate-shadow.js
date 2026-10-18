// foliate-js の paginator は shadow DOM を `mode: 'closed'` で生成し、
// 段数制御に使う CSS 変数 `--_max-column-count-portrait` を公開していない。
//
// この変数を設定するには通常アクセスできないため、`attachShadow` を一度だけ
// ラップして生成された shadow root を記録する（B の回避策）。
// 依存するのは「attachShadow が呼ばれること」「shadow 内の #top 要素」
// 「変数名 --_max-column-count-portrait」のみで、外部API/属性は変更しない。
let installed = false
const shadowRoots = new WeakMap()

export const getShadowRoot = el => (el ? shadowRoots.get(el) ?? null : null)

export const installShadowCapture = () => {
  if (installed || typeof Element === 'undefined') return
  installed = true
  const native = Element.prototype.attachShadow
  if (typeof native !== 'function') return
  Element.prototype.attachShadow = function (init) {
    const root = native.call(this, init)
    try { shadowRoots.set(this, root) } catch { /* ignore */ }
    return root
  }
}

installShadowCapture()

// paginator 要素の shadow 内 #top に CSS 変数を設定する。
// 設定できたら true、shadow 構造が変わって見つからなければ false を返す。
export const setPaginatorVar = (paginator, name, value) => {
  const root = getShadowRoot(paginator)
  if (!root?.querySelector) return false
  const top = root.querySelector('#top')
  if (!top) return false
  if (value == null) top.style.removeProperty(name)
  else top.style.setProperty(name, String(value))
  return true
}
