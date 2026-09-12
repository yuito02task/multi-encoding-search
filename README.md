# Multi-Encoding Search

**A drop-in replacement for VS Code's native workspace search that supports mixed character encodings (UTF-8, EUC-JP, Shift_JIS, EUC-KR, and more) without changing any settings.**

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/yuitomaruyama.multi-encoding-search?style=flat-square&color=blue)](https://marketplace.visualstudio.com/items?itemName=yuitomaruyama.multi-encoding-search)
[![GitHub Repository](https://img.shields.io/badge/GitHub-yuito02task%2Fmulti--encoding--search-181717?style=flat-square&logo=github)](https://github.com/yuito02task/multi-encoding-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

---

## 概要 (Overview - Japanese)

VS Code 標準のワークスペース検索は単一のエンコーディング設定（通常 UTF-8）に固定されているため、EUC-JP や Shift_JIS、EUC-KR などのレガシーファイルが混在するプロジェクトではマルチバイト文字のワードが検索でヒットせず、開いた際に文字化けが発生します。

本拡張機能は、**「置換機能を除く VS Code 標準検索の操作性と機能をそのままに、文字コード混在環境へ対応させた完全な代替ツール」** です。

面倒な設定変更や文字コード変換を必要とせず、普段のワークスペース検索の代わりにそのまま利用できます。

### 主な特徴

1. **複数文字コードの自動並行検索 & 文字コード自動維持オープン**
   - UTF-8, EUC-JP, Shift_JIS (CP932 / Windows-31J), EUC-KR, UTF-16, GB18030, Big5 などを同時に自動並行検索。
   - 検索結果をクリックすると、判定された文字コードを適用してエディタを自動再読み込み（文字化けなし）。
   - 文字コード品質スコアリングにより、文字化け行の除外や同一行の重複表示を自動で防止。

2. **VS Code 標準検索と同等の操作性・ユーザー体験**
   - **キーボードナビゲーション**: 検索結果一覧で上下キー（↑/↓）による連続プレビュー移動に対応（フォーカスは検索パネルに残したままプレビューを自動更新、Enter キーでエディタへ移動）。
   - **同一行内複数マッチの展開**: 1行に検索キーワードが複数ある場合も、標準検索同様に個別の行として分けて表示・正確に集計。
   - **検索履歴**: 上下キーで過去の検索条件を素早く呼び出し（VS Code 再起動後も永続保持）。
   - **詳細検索**: 「開いているエディターでのみ検索」「除外設定（.gitignore等）を使用してファイルを無視」ボタンを標準搭載（開閉状態もエディタ再起動後まで保持）。
   - **複数行検索**: `Shift + Enter` や貼り付けによる複数行テキストの検索、入力量に応じた入力欄の縦幅自動伸縮に対応。

3. **設定不要で即座に動作 (Zero Configuration)**
   - VS Code 内蔵の ripgrep を自動検出するため、Windows、WSL（Remote）、macOS、Linux で追加のインストールや設定を行わずに即座に動作します。

---

## Overview (English)

In VS Code, workspace search relies on a single global encoding (`files.encoding`, default UTF-8). In projects with legacy assets (e.g., PHP/Perl codebases containing mixed EUC-JP, Shift_JIS, or EUC-KR files), non-UTF-8 files cannot be searched with multi-byte queries, and opening matched files often results in garbled text (mojibake).

**Multi-Encoding Search is designed as a direct, drop-in replacement for VS Code's native search (excluding the replace feature), built specifically to solve mixed-encoding search seamlessly.**

### Key Capabilities

1. **Parallel Multi-Encoding Search & Auto-Reopen**
   - Simultaneously searches files in **UTF-8, EUC-JP, Shift_JIS (CP932), EUC-KR, UTF-16, Windows-1252, GB18030, and Big5** in parallel.
   - Automatically reopens clicked files in their detected encoding with exact multi-byte offset highlighting.
   - Built-in character scoring eliminates garbled lines and duplicate matches across encodings.

2. **Native VS Code Search UX & Keyboard Navigation**
   - **Interactive Results Navigation**: Navigate matches seamlessly using Up/Down arrow keys with live editor preview synchronization while keeping focus in the search viewlet. Press Enter to focus the editor.
   - **Accurate Multi-match Lines**: Correctly splits and counts multiple occurrences on the same line.
   - **Search History**: Instant navigation of past queries with Up/Down arrow keys, persisted across VS Code restarts.
   - **Search Details**: Standard include/exclude filters with "Search only in Open Editors" and "Use Exclude Settings and Ignore Files" toggles. Expanded/collapsed state persists across sessions.
   - **Multi-line Query Support**: Supports multi-line input via `Shift + Enter` or pasting, with auto-growing textarea and line wrapping.

3. **Zero Configuration**
   - Automatically discovers the bundled ripgrep binary across Windows, WSL, macOS, and Linux without manual PATH setup.

---

## Extension Settings / 設定一覧

| Setting | Default | Description (説明) |
|---|---|---|
| `multiEncodingSearch.encodings.*` | `true` | 個別文字コードの検索有効/無効 (UTF-8, EUC-JP, Shift_JIS, UTF-16LE/BE, Windows-1252, GB18030, GBK, Big5, EUC-KR) |
| `multiEncodingSearch.results.showLineNumbers` | `false` | 検索結果に行番号を表示するかどうか |
| `multiEncodingSearch.results.fontSize` | `0` | 検索結果のフォントサイズ (0でVS Code標準設定を使用) |
| `multiEncodingSearch.results.fontFamily` | `""` | 検索結果のフォントファミリ |
| `multiEncodingSearch.results.matchHighlightBackground` | `""` | 検索キーワード一致箇所のハイライト背景色 (例: `'#ea5c0055'`) |
| `multiEncodingSearch.results.matchHighlightForeground` | `""` | 検索キーワード一致箇所の文字色 |
| `multiEncodingSearch.results.textColor` | `""` | 検索結果行プレビューの文字色 |
| `multiEncodingSearch.results.secondaryTextColor` | `""` | 行番号やディレクトリパスの文字色 |
| `multiEncodingSearch.rgPath` | `"rg"` | ripgrep 実行ファイルのカスタムパス (通常は自動検出されます) |

---

## License

MIT License (Copyright (c) 2026 yuitomaruyama)
