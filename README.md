# GotchaPins Tools

GotchaPins のブラウザ内で完結するツール群。GitHub Pages で配信する。

## 方針

- **サーバーを持たない。** 生成処理はすべてユーザーのブラウザで実行する
- **入力したデータはPCから出ない。** アップロードが存在しないので、肖像・個人情報・画像モデレーションの論点が発生しない
- 依存ライブラリ無し（素の JS）。静的ホスティングのみ

## ツール

| パス | 中身 | 状態 |
|---|---|---|
| `/generator/` | ピンズジェネレーター（P-024）。メッセージと写真から固有ピンズの `.unitypackage` を作る | 準備中 |

## 開発メモ

- ⚠️ `CompressionStream` / `DecompressionStream` は **https 必須**。`file://` で開いても動かない。動作確認は Pages 上で行う
- `.nojekyll` は消さないこと（`_` 始まりのファイルが Jekyll に無視されるのを防ぐ）

設計は本体リポジトリの `06_work/product_lineup/P-024_PinsGeneratorWeb.md` を参照。
