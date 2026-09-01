// generator.js — テンプレから「固有ピンズ」の .unitypackage を組み立てる
//
// ★中心にある考え方（P-024 §6-3）
//   Unity のコンポーネントはアセットを「パス」ではなく GUID で参照する。
//   だからテンプレ側で Prefab → 写真 の参照を張っておけば、
//   生成時は【GUIDに紐づいた中身を差し替えるだけ】でよい。パスの書き換えは要らない。
//
// ★絶対に外せないこと（P-024 §6-4）
//   生成のたびに固有ゾーンの GUID を全部振り直す。
//   同じ GUID のまま配ると、受け取った人が2個目を入れた瞬間に1個目が消える。
//   しかも Unity は pathname を無視して既存アセットの場所を上書きするので、
//   まったく無関係なアセットまで壊しうる。

import { untar, tarGnu, gunzip, gzipForUnity, newGuid, toText, toBytes, replaceGuids } from './unitypackage.js';

const TEMPLATE_ROOT = 'Assets/_GP_GenTest';
const UNIQUE_PREFIX = 'Assets/_GP_GenTest/Template';   // 固有ゾーン（GUIDをリマップする）
const DEST_ROOT     = 'Assets/GotchaPins';             // 共通ゾーンの配置先
const DEST_PINS     = 'Assets/GotchaPins/Pins';        // 固有ゾーンの配置先

let _template = null;

/** テンプレを読み込む。同じオリジンに置いてあるので CORS の設定は要らない。 */
export async function loadTemplate(url = './template.unitypackage') {
  if (_template) return _template;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`テンプレートを取得できませんでした (${res.status})`);
  const bin = new Uint8Array(await res.arrayBuffer());
  _template = untar(await gunzip(bin));
  return _template;
}

/** YAML の二重引用符スカラーとして安全な形にする。 */
function yamlQuote(s) {
  const body = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${body}"`;
}

/** 20260901_3f9ac2 のような、人が見て日付が分かるID。 */
export function newPinId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const ymd = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const rnd = newGuid().slice(0, 6);
  return `${ymd}_${rnd}`;
}

/**
 * @param {object} opts
 * @param {string} opts.message  ピンズに差し込むメッセージ
 * @param {Uint8Array|null} opts.photo  PNG バイト列。null ならテンプレの写真のまま
 * @param {string} [opts.pinId]
 * @returns {Promise<{bytes: Uint8Array, pinId: string, fileName: string, guidMap: Array}>}
 */
export async function generate({ message, photo, pinId }) {
  const tpl = await loadTemplate();
  pinId = pinId || newPinId();

  // pathname を取り出す（1行のテキスト）
  const pathOf = new Map();
  for (const [guid, files] of tpl) {
    if (!files.pathname) continue;
    pathOf.set(guid, toText(files.pathname).split('\n')[0]);
  }

  const isUnique = (guid) => (pathOf.get(guid) || '').startsWith(UNIQUE_PREFIX);
  const isFile = (guid) => !!tpl.get(guid).asset;

  // ── 1. 固有ゾーンのファイルにだけ、新しい GUID を採番する ──
  //     共通ゾーン（メッシュ/マテリアル/スクリプト）は絶対に触らない。
  //     ここを触ると、2個目のピンズが1個目の共通アセットを別物として複製してしまう。
  const guidMap = new Map();
  for (const guid of [...tpl.keys()].sort()) {
    if (isUnique(guid) && isFile(guid)) guidMap.set(guid, newGuid());
  }

  const out = new Map();

  for (const [guid, files] of tpl) {
    const path = pathOf.get(guid) || '';
    const unique = isUnique(guid);

    // 固有ゾーンのフォルダ entry は捨てる（Unity が pathname から自動で作る）
    if (unique && !isFile(guid)) continue;

    const d = { ...files };

    // ── 2. 中身の差し替え。GUID は据え置きなので参照は壊れない ──
    if (path.endsWith('/素材/photo.png') && photo) {
      d.asset = photo;
    } else if (path.endsWith('.prefab')) {
      const yaml = toText(d.asset);
      if (!yaml.includes('message: __MESSAGE__')) {
        throw new Error('テンプレートにメッセージのプレースホルダがありません');
      }
      d.asset = toBytes(yaml.replace('message: __MESSAGE__', 'message: ' + yamlQuote(message)));
    }

    // ── 3. 新しい GUID を全文置換（.meta と YAML の両方に効かせる）──
    if (d['asset.meta']) d['asset.meta'] = replaceGuids(d['asset.meta'], guidMap);
    if (d.asset && /\.(prefab|mat|asset)$/.test(path)) {
      d.asset = replaceGuids(d.asset, guidMap);
    }

    // ── 4. 配置先をユニークにする。GUID が別でもパスが同じなら上書きされる ──
    if (unique) {
      const rel = path.slice(UNIQUE_PREFIX.length).replace(/^\//, '');
      d.pathname = toBytes(`${DEST_PINS}/${pinId}/${rel}`);
      delete d['preview.png'];                          // 前の写真のサムネを残さない
    } else {
      d.pathname = toBytes(path.replace(TEMPLATE_ROOT, DEST_ROOT));
    }

    out.set(guidMap.get(guid) || guid, d);
  }

  const bytes = await gzipForUnity(tarGnu(out));
  return { bytes, pinId, fileName: `GotchaPins_${pinId}.unitypackage`, guidMap: [...guidMap] };
}

/** 画像を PNG・指定辺以下に正規化する。★.meta を据え置けるようにするため形式を固定する（§6-5）。 */
export async function normalizePhoto(file, maxSide = 1024) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
}
