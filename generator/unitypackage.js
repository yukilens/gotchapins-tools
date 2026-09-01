// unitypackage.js — .unitypackage を読み書きする最小実装
//
// .unitypackage の実体は「gzip された GNU tar」で、中身は
//   {GUID}/pathname      … 配置先パス
//   {GUID}/asset         … ファイル本体（フォルダには無い）
//   {GUID}/asset.meta    … .meta の中身
//   {GUID}/preview.png   … サムネ（任意）
// という平たい構造をしている。
//
// ⚠️ 無言で失敗する落とし穴が3つある（P-024 §7-4 で実測）。ここを外すと
//    Unity は「インポート完了」を返しながら1件も取り込まない。
//    (1) tar は GNU 形式でないといけない（POSIX/PAX は不可）
//    (2) GUID ごとの「ディレクトリ entry」が必要（ファイル entry だけでは無視される）
//    (3) gzip ヘッダの OS バイトは 3(Unix)。255(unknown) だと拒否される

const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

// ───────────────────────── gzip ─────────────────────────

export async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** ★gzip ヘッダを手書きして OS=3(Unix) にする。ここが (3) の対処。 */
export async function gzipForUnity(raw) {
  const s = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const body = new Uint8Array(await new Response(s).arrayBuffer());

  const out = new Uint8Array(10 + body.length + 8);
  //        ID1   ID2   CM(deflate) FLG   MTIME(4)      XFL   OS=3(Unix)
  out.set([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0x03], 0);
  out.set(body, 10);

  const dv = new DataView(out.buffer);
  dv.setUint32(10 + body.length, crc32(raw), true);
  dv.setUint32(10 + body.length + 4, raw.length >>> 0, true);
  return out;
}

// ───────────────────────── tar 読み ─────────────────────────

function readStr(bytes, off, len) {
  let end = off;
  const stop = off + len;
  while (end < stop && bytes[end] !== 0) end++;
  return dec.decode(bytes.subarray(off, end));
}

function readOctal(bytes, off, len) {
  const s = readStr(bytes, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

/**
 * tar を解いて { guid: { pathname: Uint8Array, asset: ..., ... } } にする。
 * ディレクトリ entry は捨てる（再構築時に作り直すため）。
 */
export function untar(bytes) {
  const ents = new Map();
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const name = readStr(bytes, off, 100);
    if (!name) break;                                  // 終端（ゼロブロック）
    const size = readOctal(bytes, off + 124, 12);
    const type = String.fromCharCode(bytes[off + 156]);
    off += BLOCK;

    if (type !== '5') {                                // '5' = ディレクトリ
      const slash = name.indexOf('/');
      if (slash > 0) {
        const guid = name.slice(0, slash);
        const file = name.slice(slash + 1);
        if (!ents.has(guid)) ents.set(guid, {});
        ents.get(guid)[file] = bytes.subarray(off, off + size);
      }
    }
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return ents;
}

// ───────────────────────── tar 書き ─────────────────────────

function octal(n, width) {                             // "0000755\0" の形
  return enc.encode(n.toString(8).padStart(width - 1, '0') + '\0');
}

function header(name, size, isDir, mtime) {
  const h = new Uint8Array(BLOCK);
  const nameBytes = enc.encode(name);
  if (nameBytes.length > 100) throw new Error('tar: 名前が長すぎる ' + name);
  h.set(nameBytes, 0);
  h.set(octal(isDir ? 0o755 : 0o644, 8), 100);         // mode
  h.set(octal(0, 8), 108);                             // uid
  h.set(octal(0, 8), 116);                             // gid
  h.set(octal(size, 12), 124);                         // size
  h.set(octal(mtime, 12), 136);                        // mtime
  h.fill(0x20, 148, 156);                              // chksum は空白で埋めてから計算する
  h[156] = isDir ? 0x35 : 0x30;                        // typeflag '5' / '0'
  h.set(enc.encode('ustar  \0'), 257);                 // ★GNU magic。ここが (1) の対処
  h.set(octal(0, 8), 329);                             // devmajor
  h.set(octal(0, 8), 337);                             // devminor

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  return h;
}

/**
 * { guid: { file: Uint8Array } } を GNU tar にする。
 * ★GUID ごとにディレクトリ entry を必ず先に置く（(2) の対処）。
 */
export function tarGnu(ents) {
  const mtime = Math.floor(Date.now() / 1000);
  const chunks = [];
  let total = 0;
  const push = (b) => { chunks.push(b); total += b.length; };

  for (const guid of [...ents.keys()].sort()) {
    push(header(guid, 0, true, mtime));                // ★ディレクトリ entry
    const files = ents.get(guid);
    for (const file of Object.keys(files).sort()) {
      const body = files[file];
      push(header(guid + '/' + file, body.length, false, mtime));
      push(body);
      const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
      if (pad) push(new Uint8Array(pad));
    }
  }
  push(new Uint8Array(BLOCK * 2));                     // 終端

  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ───────────────────────── GUID ─────────────────────────

/** Unity の GUID は 16進32桁。crypto から採る。 */
export function newGuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

// ───────────────────────── 文字列ユーティリティ ─────────────────────────

export const toText = (bytes) => dec.decode(bytes);
export const toBytes = (text) => enc.encode(text);

/** バイト列の中の GUID 文字列を一括置換する（.meta と YAML の両方に効く）。 */
export function replaceGuids(bytes, map) {
  let text = dec.decode(bytes);
  let hit = false;
  for (const [oldG, newG] of map) {
    if (text.includes(oldG)) { text = text.split(oldG).join(newG); hit = true; }
  }
  return hit ? enc.encode(text) : bytes;
}
