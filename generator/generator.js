// generator.js — テンプレから「固有フォトピンズ」の .unitypackage を組み立てる
//
// ★中心にある考え方（P-024 §6-3）
//   Unity のコンポーネントはアセットを「パス」ではなく GUID で参照する。
//   だからテンプレ側で Prefab → マテリアル → 写真 の参照を張っておけば、
//   生成時は【GUIDに紐づいた中身を差し替えるだけ】でよい。パスの書き換えは要らない。
//
// ★絶対に外せないこと（P-024 §6-4）
//   生成のたびに固有ゾーンの GUID を全部振り直す。
//   同じ GUID のまま配ると、受け取った人が2個目を入れた瞬間に1個目が消える。
//   しかも Unity は pathname を無視して既存アセットの場所を上書きするので、
//   まったく無関係なアセットまで壊しうる。
//
// ゾーン分け
//   Common … photopins.fbx / メタル.mat / PinLabelSource.cs
//            ★GUID も配置先も固定。ここを振り直すと共通資産が人数分に増える
//   Unique … GP_PhotoPin.prefab / 素材/GP_PhotoPin_Photo.mat / 素材/photo.png
//            ★写真マテリアルが Unique なのは、per-pin のテクスチャGUIDを参照しているため。
//              Common に置くと全員で1枚を共有してしまい、後勝ちで写真が上書きされる。

import { untar, tarGnu, gunzip, gzipForUnity, newGuid, toText, toBytes, replaceGuids } from './unitypackage.js';

const UNIQUE_PREFIX = 'Assets/GotchaPins/_Template';
const DEST_PINS     = 'Assets/GotchaPins/Pins';

// PinLabelSource.cs が持っている上限（P-021 §15 の表示領域から逆算した実値）
export const LIMITS = {
  name: 8,        // ピンズ名：全角8文字
  date: 10,       // 配布日付：10文字（例 2026.09.01）
  msgLine: 14,    // メッセージ：1行14文字
  msgLines: 4,    //             4行まで
};

const PHOTO_W = 512;          // 保存解像度（2の冪＝DXT圧縮が効く）
const PHOTO_H = 1024;
const PHOTO_ASPECT = 9 / 16;  // ★表示上の比。板（フォト）の実寸 18.9 × 33.6mm と一致

let _template = null;

/** テンプレを読み込む。同じオリジンに置いてあるので CORS の設定は要らない。 */
export async function loadTemplate(url = './template.unitypackage') {
  if (_template) return _template;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`テンプレートを取得できませんでした (${res.status})`);
  _template = untar(await gunzip(new Uint8Array(await res.arrayBuffer())));
  return _template;
}

/** 書記素で数える（絵文字や結合文字を1文字と数えるため）。 */
export function charCount(s) {
  if (!s) return 0;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('ja').segment(s)].length;
  }
  return [...s].length;
}

/** 上限を超えている項目名の配列を返す。空なら問題なし。 */
export function validate({ name, date, message }) {
  const over = [];
  if (!name || !name.trim()) over.push('ピンズ名が空');
  else if (charCount(name) > LIMITS.name) over.push(`ピンズ名が${LIMITS.name}文字を超えている`);
  if (!date || !date.trim()) over.push('配布日付が空');
  else if (charCount(date) > LIMITS.date) over.push(`配布日付が${LIMITS.date}文字を超えている`);
  if (message) {
    const lines = message.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > LIMITS.msgLines) over.push(`メッセージが${LIMITS.msgLines}行を超えている`);
    if (lines.some((l) => charCount(l) > LIMITS.msgLine)) over.push(`メッセージの1行が${LIMITS.msgLine}文字を超えている`);
  }
  return over;
}

/** YAML の二重引用符スカラーとして安全な形にする。 */
function yamlQuote(s) {
  const body = String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${body}"`;
}

export function todayString(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${p(now.getMonth() + 1)}.${p(now.getDate())}`;
}

/** 20260901_3f9ac2 のような、人が見て日付が分かるID。 */
export function newPinId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${newGuid().slice(0, 6)}`;
}

/**
 * @param {object} opts
 * @param {string} opts.name     ピンズ名
 * @param {string} opts.date     配布日付
 * @param {string} opts.message  メッセージ（任意）
 * @param {Uint8Array} opts.photo  PNG バイト列（512×1024）
 */
export async function generate({ name, date, message, photo, pinId }) {
  const problems = validate({ name, date, message });
  if (problems.length) throw new Error(problems.join(' / '));
  if (!photo) throw new Error('写真が選ばれていません');

  const tpl = await loadTemplate();
  pinId = pinId || newPinId();

  const pathOf = new Map();
  for (const [guid, files] of tpl) {
    if (files.pathname) pathOf.set(guid, toText(files.pathname).split('\n')[0]);
  }
  const isUnique = (g) => (pathOf.get(g) || '').startsWith(UNIQUE_PREFIX);
  const isFile = (g) => !!tpl.get(g).asset;

  // ── 1. 固有ゾーンのファイルにだけ新しい GUID を採番する ──
  const guidMap = new Map();
  for (const g of [...tpl.keys()].sort()) {
    if (isUnique(g) && isFile(g)) guidMap.set(g, newGuid());
  }

  const out = new Map();

  for (const [guid, files] of tpl) {
    const path = pathOf.get(guid) || '';
    const unique = isUnique(guid);
    if (unique && !isFile(guid)) continue;      // 固有ゾーンのフォルダentryは捨てる

    const d = { ...files };

    // ── 2. 中身の差し替え（GUIDは据え置きなので参照は壊れない）──
    if (path.endsWith('/素材/photo.png')) {
      d.asset = photo;
    } else if (path.endsWith('.prefab')) {
      let yaml = toText(d.asset);
      for (const [ph, val] of [['__NAME__', name], ['__DATE__', date], ['__MESSAGE__', message || '']]) {
        if (!yaml.includes(ph)) throw new Error(`テンプレートに ${ph} がありません`);
        yaml = yaml.replace(ph, yamlQuote(val));
      }
      d.asset = toBytes(yaml);
    }

    // ── 3. 新しい GUID を全文置換（.meta と YAML の両方に効かせる）──
    if (d['asset.meta']) d['asset.meta'] = replaceGuids(d['asset.meta'], guidMap);
    if (d.asset && /\.(prefab|mat|asset)$/.test(path)) d.asset = replaceGuids(d.asset, guidMap);

    // ── 4. 配置先をユニークにする。GUIDが別でもパスが同じなら上書きされる ──
    if (unique) {
      const rel = path.slice(UNIQUE_PREFIX.length).replace(/^\//, '');
      d.pathname = toBytes(`${DEST_PINS}/${pinId}/${rel}`);
      delete d['preview.png'];                  // 前の写真のサムネを残さない
    }
    // Common は pathname も GUID もそのまま（共有資産なので動かさない）

    out.set(guidMap.get(guid) || guid, d);
  }

  const bytes = await gzipForUnity(tarGnu(out));
  const safe = (name || 'pin').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24);
  return { bytes, pinId, fileName: `GotchaPins_${safe}_${pinId}.unitypackage`, guidMap: [...guidMap] };
}

/**
 * 写真を「中央で 9:16 に切って 512×1024 の PNG」に正規化する。
 * ★保存が 1:2 なのは2の冪にして DXT 圧縮を効かせるため。
 *   表示は 9:16 の板に貼るので、見た目の比率は元のまま戻る（歪まない）。
 */
export async function normalizePhoto(file) {
  const bmp = await createImageBitmap(file);
  const srcW = bmp.width, srcH = bmp.height;
  const srcAspect = srcW / srcH;

  let cw, ch;
  if (srcAspect > PHOTO_ASPECT) { ch = srcH; cw = ch * PHOTO_ASPECT; }  // 横長 → 左右を切る
  else                          { cw = srcW; ch = cw / PHOTO_ASPECT; }  // 縦長 → 上下を切る
  const sx = (srcW - cw) / 2;
  const sy = (srcH - ch) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_W; canvas.height = PHOTO_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, cw, ch, 0, 0, PHOTO_W, PHOTO_H);
  bmp.close?.();

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: PHOTO_W, height: PHOTO_H,
    srcWidth: srcW, srcHeight: srcH,
    cropped: Math.abs(srcAspect - PHOTO_ASPECT) > 0.001,
  };
}
