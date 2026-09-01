// app.js — 画面まわり。生成そのものは generator.js が持つ。
import { generate, normalizePhoto, loadTemplate } from './generator.js';

const $ = (id) => document.getElementById(id);
const els = {
  fatal: $('fatal'), message: $('message'), count: $('count'),
  drop: $('drop'), file: $('file'), preview: $('preview'),
  thumb: $('thumb'), pmeta: $('pmeta'), clear: $('clear'),
  go: $('go'), result: $('result'),
};

const MAX = 400;
let photo = null;          // { bytes, width, height }
let thumbUrl = null;

// ───────── 動く環境かどうかを最初に確かめる ─────────
function checkEnv() {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
    return 'このブラウザは CompressionStream に対応していません。Chrome / Edge の新しい版でお試しください。';
  }
  if (!window.isSecureContext) {
    return 'https で開いてください。ファイルを直接開くと圧縮処理が動きません。';
  }
  return null;
}

function fatal(text) {
  els.fatal.textContent = text;
  els.fatal.classList.add('on');
  els.go.disabled = true;
}

// ───────── メッセージ ─────────
function updateCount() {
  const n = [...els.message.value].length;
  els.count.textContent = `${n} / ${MAX}`;
  els.count.classList.toggle('over', n > MAX);
}
els.message.addEventListener('input', updateCount);

// ───────── 写真 ─────────
async function setPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    fatal('画像ファイルを選んでください。');
    return;
  }
  try {
    photo = await normalizePhoto(file);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(new Blob([photo.bytes], { type: 'image/png' }));
    els.thumb.src = thumbUrl;
    els.pmeta.textContent = `PNG ${photo.width}×${photo.height} ／ ${(photo.bytes.length / 1024).toFixed(0)} KB`;
    els.preview.classList.add('on');
  } catch (e) {
    fatal('画像を読み込めませんでした: ' + e.message);
  }
}

els.drop.addEventListener('click', () => els.file.click());
els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); }
});
els.file.addEventListener('change', () => setPhoto(els.file.files[0]));
['dragenter', 'dragover'].forEach((t) =>
  els.drop.addEventListener(t, (e) => { e.preventDefault(); els.drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach((t) =>
  els.drop.addEventListener(t, () => els.drop.classList.remove('hot')));
els.drop.addEventListener('drop', (e) => {
  e.preventDefault();
  setPhoto(e.dataTransfer.files[0]);
});
els.clear.addEventListener('click', () => {
  photo = null;
  els.preview.classList.remove('on');
  els.file.value = '';
});

// ───────── 生成 ─────────
els.go.addEventListener('click', async () => {
  const message = els.message.value.trim();
  if (!message) { els.message.focus(); return; }
  if ([...message].length > MAX) { els.message.focus(); return; }

  els.go.disabled = true;
  els.go.textContent = '作っています…';
  els.result.classList.remove('on');

  try {
    const r = await generate({ message, photo: photo ? photo.bytes : null });

    const url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = r.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    els.result.innerHTML = `
      <b>できました。</b>ダウンロードが始まっていなければ
      <a href="${url}" download="${r.fileName}">こちら</a>。
      <ol>
        <li>ファイル名 <code>${r.fileName}</code>（${(r.bytes.length / 1024).toFixed(0)} KB）</li>
        <li>Unity プロジェクトのウィンドウにドラッグして取り込む</li>
        <li><code>Assets/GotchaPins/Pins/${r.pinId}/</code> に入ります</li>
      </ol>`;
    els.result.classList.add('on');
  } catch (e) {
    els.result.innerHTML = '';
    fatal('生成に失敗しました: ' + e.message);
    console.error(e);
  } finally {
    els.go.disabled = false;
    els.go.textContent = 'ピンズを作る';
  }
});

// ───────── 起動 ─────────
const envError = checkEnv();
if (envError) {
  fatal(envError);
} else {
  els.go.disabled = true;
  loadTemplate()
    .then(() => { els.go.disabled = false; })
    .catch((e) => fatal(e.message));
}
updateCount();

// 動作確認用（コンソールから叩けるようにしておく）
window.GP = { generate, normalizePhoto, loadTemplate };
