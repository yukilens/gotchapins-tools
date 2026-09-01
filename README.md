# GotchaPins Tools

GotchaPins のブラウザ内で完結するツール群。GitHub Pages で配信する。

## 方針

- **サーバーを持たない。** 生成処理はすべてユーザーのブラウザで実行する
- **入力したデータはPCから出ない。** アップロードが存在しないので、肖像・個人情報・画像モデレーションの論点が発生しない
- 依存ライブラリ無し（素の JS）。静的ホスティングのみ

## ツール

| パス | 中身 | 状態 |
|---|---|---|
| [`/generator/`](https://yukilens.github.io/gotchapins-tools/generator/) | **フォトピンズジェネレーター**（P-024）。写真とメッセージから固有ピンズの `.unitypackage` を作る | **お試し版 稼働中** |

## 開発メモ

- ⚠️ `CompressionStream` / `DecompressionStream` は **https 必須**。`file://` で開いても動かない。動作確認は Pages 上で行う
- `.nojekyll` は消さないこと（`_` 始まりのファイルが Jekyll に無視されるのを防ぐ）

### フォトピンズ テンプレート

| ゾーン | 中身 | 扱い |
|---|---|---|
| **Common** | `photopins.fbx` / `メタル.mat` / `PinLabelSource.cs` | ★GUID も配置先も固定。**振り直すと共通資産が人数分に増える** |
| **Unique** | `GP_PhotoPin.prefab` / `素材/GP_PhotoPin_Photo.mat` / `素材/photo.png` | 生成のたびに GUID をリマップし `Assets/GotchaPins/Pins/{pinId}/` へ |

- ★**写真マテリアルが Unique なのは、per-pin のテクスチャ GUID を参照しているから。** Common に置くと全員で1枚を共有し、後勝ちで写真が上書きされる
- ★`PinLabelSource.cs` は GUID `f620a42056ecbec409b34defe4d681ae` 固定。**P-021 のケースと同じGUIDなので、両方入れても二重定義にならない**
- lilToon（`lts.shader` / matcap）は**同梱しない**。再配布になるうえ、相手の lilToon を壊しうる。**導入前提**
- 写真は中央を 9:16 に切って **512×1024 の PNG** に正規化する。保存が 1:2 なのは2の冪にして DXT 圧縮を効かせるため（表示は 9:16 の板なので歪まない）

設計は本体リポジトリの `06_work/product_lineup/P-024_PinsGeneratorWeb.md` を参照。
