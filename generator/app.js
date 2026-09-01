// app.js — 画面まわり。生成そのものは generator.js が持つ。
import { generate, normalizePhoto, loadTemplate, validate, charCount, todayString, LIMITS } from './generator.js';

const $ = (id) => document.getElementById(id);
const els = {
  fatal: $('fatal'), name: $('name'), date: $('date'), message: $('message'),
  cName: $('cName'), cDate: $('cDate'), cMsg: $('cMsg'),
  drop: $('drop'), file: $('file'), pbox: $('pbox'), pcap: $('pcap'),
  go: $('go'), result: $('result'),
};

let photo = null;
let thumbUrl = null;
let templateReady = false;

// ───────── 動く環境かどうかを最初に確かめる ─────────
function checkEnv() {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined')
    return 'このブラウザは CompressionStream に対応していません。Chrome / Edge の新しい版でお試しください。';
  if (!window.isSecureContext)
    return 'https で開いてください。ファイルを直接開くと圧縮処理が動きません。';
  return null;
}

function fatal(text) {
  els.fatal.textContent = text;
  els.fatal.classList.add('on');
}
function clearFatal() {
  els.fatal.textContent = '';
  els.fatal.classList.remove('on');
}

// ───────── 文字数の表示と可否判定 ─────────
function refresh() {
  const n = charCount(els.name.value);
  els.cName.textContent = `${n} / ${LIMITS.name}`;
  els.cName.classList.toggle('over', n > LIMITS.name);

  const d = charCount(els.date.value);
  els.cDate.textContent = `${d} / ${LIMITS.date}`;
  els.cDate.classList.toggle('over', d > LIMITS.date);

  const lines = els.message.value.replace(/\r\n?/g, '\n').split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, charCount(l)), 0);
  const rows = els.message.value ? lines.length : 0;
  els.cMsg.textContent = `${rows}行 / ${LIMITS.msgLines}　最長 ${longest} / ${LIMITS.msgLine}`;
  els.cMsg.classList.toggle('over', rows > LIMITS.msgLines || longest > LIMITS.msgLine);

  const problems = validate({
    name: els.name.value, date: els.date.value, message: els.message.value,
  });
  els.go.disabled = !templateReady || problems.length > 0 || !photo;
}
['input', 'change'].forEach((e) => {
  els.name.addEventListener(e, refresh);
  els.date.addEventListener(e, refresh);
  els.message.addEventListener(e, refresh);
});

// ───────── 写真 ─────────
async function setPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { fatal('画像ファイルを選んでください。'); return; }
  try {
    clearFatal();
    photo = await normalizePhoto(file);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(new Blob([photo.bytes], { type: 'image/png' }));
    els.pbox.innerHTML = '';
    const img = new Image();
    img.src = thumbUrl;
    img.alt = '切り出し結果';
    els.pbox.appendChild(img);
    els.pcap.textContent = `${photo.srcWidth}×${photo.srcHeight} → ${photo.width}×${photo.height}`
      + (photo.cropped ? '（中央を切り出し）' : '');
  } catch (e) {
    fatal('画像を読み込めませんでした: ' + e.message);
  }
  refresh();
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
els.drop.addEventListener('drop', (e) => { e.preventDefault(); setPhoto(e.dataTransfer.files[0]); });

// ───────── 生成 ─────────
els.go.addEventListener('click', async () => {
  els.go.disabled = true;
  els.go.textContent = '作っています…';
  els.result.classList.remove('on');
  clearFatal();

  try {
    const r = await generate({
      name: els.name.value.trim(),
      date: els.date.value.trim(),
      message: els.message.value.replace(/\s+$/, ''),
      photo: photo.bytes,
    });

    const url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = r.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    els.result.innerHTML = `
      <b>できました。</b>ダウンロードが始まっていなければ
      <a href="${url}" download="${r.fileName}">こちら</a>。
      <ol>
        <li><code>${r.fileName}</code>（${(r.bytes.length / 1024).toFixed(0)} KB）</li>
        <li>Unity プロジェクトのウィンドウにドラッグして取り込む</li>
        <li><code>Assets/GotchaPins/Pins/${r.pinId}/</code> に入ります</li>
      </ol>`;
    els.result.classList.add('on');
  } catch (e) {
    fatal('生成に失敗しました: ' + e.message);
    console.error(e);
  } finally {
    els.go.textContent = 'ピンズを作る';
    refresh();
  }
});

// ───────── 起動 ─────────
els.date.value = todayString();
const envError = checkEnv();
if (envError) {
  fatal(envError);
  els.go.disabled = true;
} else {
  els.go.disabled = true;
  loadTemplate()
    .then(() => { templateReady = true; refresh(); })
    .catch((e) => fatal(e.message));
}
refresh();

// 動作確認用（コンソールから叩けるようにしておく）
window.GP = { generate, normalizePhoto, loadTemplate, validate, charCount, todayString, LIMITS };
