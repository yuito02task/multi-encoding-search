# Multi-Encoding Search

A VS Code extension that enables simultaneous workspace search across multiple character encodings (**UTF-8, EUC-JP, Shift_JIS, UTF-16LE/BE, Windows-1252, GB18030, GBK, Big5, EUC-KR**), and opens matched files in their detected encoding.

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/yuitomaruyama.multi-encoding-search?style=flat-square&color=blue)](https://marketplace.visualstudio.com/items?itemName=yuitomaruyama.multi-encoding-search)
[![GitHub Repository](https://img.shields.io/badge/GitHub-yuito02task%2Fmulti--encoding--search-181717?style=flat-square&logo=github)](https://github.com/yuito02task/multi-encoding-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

---

## Why this extension?

In VS Code, workspace search uses a single global encoding (`files.encoding`, default UTF-8). When working with mixed-encoding legacy codebases (such as PHP/Perl projects containing EUC-JP or Shift_JIS files), non-UTF-8 files cannot be searched with Japanese queries, and clicking a result often results in garbled text (mojibake).

This extension addresses the long-standing workspace search limitations discussed in the official VS Code repository:
- [microsoft/vscode#127896](https://github.com/microsoft/vscode/issues/127896) — Support searching in multiple encodings
- [microsoft/vscode#256502](https://github.com/microsoft/vscode/issues/256502) — Search with specific file encoding
- [microsoft/vscode#23570](https://github.com/microsoft/vscode/issues/23570) — Support searching in non-UTF-8 files
- [VS Code Search Issues Wiki](https://github.com/microsoft/vscode/wiki/Search-Issues)

---

## Features

- **Multi-line Search & Auto-grow**: Supports multi-line search queries via pasting or `Shift + Enter`. The search input box automatically wraps long queries cleanly before reaching toggle buttons and expands vertically.
- **Enhanced Native Search Options**: Includes "Search only in Open Editors" button and "Use Exclude Settings and Ignore Files" toggle button in include/exclude filters.
- **Search History Navigation & Persistence**: Seamlessly navigate past search keywords using Up/Down arrow keys with debounced execution and empty reset. Search histories persist across sessions and restarts via VS Code globalState.
- **Interactive Keyboard Navigation**: Click any result to select it with native highlight styling, and navigate between matches and files effortlessly using Up/Down arrow keys and Enter.
- **Strict Sorting & Result Stability**: Guarantees consistent natural alphabetical ordering of search results (directory hierarchy followed by natural file name order) even across parallel multi-threaded processes.
- **Parallel Multi-Encoding Search**: Runs `ripgrep` across `EUC-JP`, `Shift_JIS` (CP932 / Windows-31J), and `UTF-8` in parallel by default, with configurable support for `UTF-16LE/BE`, `Windows-1252` (Latin-1), `GB18030`, `GBK`, `Big5`, and `EUC-KR`. Intelligent quality scoring automatically selects the best decoded text and eliminates duplicate lines across encodings.
- **Native File Icons & Theme Integration**: Displays file icons next to file names matching your active VS Code File Icon Theme (e.g., Material Icon Theme, Seti, vscode-icons) with automatic fallbacks.
- **Native VS Code Search UX**: Results are organized cleanly by directory hierarchy, file name, and line number with standard filename + directory path styling and compact search input spacing.
- **Auto Indentation Trimming**: Trims deep leading indentations from code previews while keeping match highlights perfectly aligned for optimal sidebar readability.
- **Fast Streaming & Optimized UI**: Incremental rendering and instant progress feedback stream matches smoothly into the view with low memory and CPU overhead.
- **Auto-Reopen in Detected Encoding**: Clicking a search result reopens the editor with the matched encoding (`eucjp` / `shiftjis` / `utf8` / `utf16le` / `windows1252` / `gb18030` etc.) and highlights the exact match with perfect multi-byte character offset precision.
- **Customizable Appearance**: Customize result line numbers (`showLineNumbers`), font size, font family, match highlight colors, and text colors directly via VS Code settings.
- **Zero Configuration**: Automatically resolves the ripgrep binary across Windows, WSL (Remote), macOS, and Linux without extra setup.
- **Native Search Options**: Supports Case Sensitivity (`Aa`), Whole Word (`\b`), Regular Expressions (`.*`), and glob filters (`files to include` / `files to exclude`).

---

## 開発の背景と特徴 (日本語)

VS Code の標準検索は `files.encoding`（通常 UTF-8）に依存しているため、EUC-JP や Shift_JIS の既存ファイルが混在するプロジェクトでは日本語検索がヒットせず、開いた際に文字化けが発生します。

本拡張機能は、上記 VS Code 公式 Issue で議論されてきた課題を解決するものです。

### 主な機能
1. **複数行文字列の検索 & 自動折り返し**: `Shift + Enter` での改行入力や複数行テキストの貼り付け検索に対応。トグルボタンに被らない位置で自動折り返し、行数に応じて入力欄の高さが伸縮します。
2. **開いているエディターのみ検索 & 除外設定無視トグル**: VS Code 標準検索同様、「含めるファイル」に入力欄一体型の「開いているエディターでのみ検索」ボタン、「除外するファイル」に「除外設定を使用してファイルを無視（.gitignoreの有効/無効）」ボタンを搭載。
3. **上下キー履歴ナビゲーション & 日をまたいだ永続化**: 検索欄で上下キー（↑/↓）による軽快なデバウンス履歴参照に対応。最新履歴の次は空欄に戻り、VS Code を再起動しても履歴が保持されます。
4. **検索結果リストのキーボード操作 & 選択状態ハイライト**: 検索結果をクリックすると標準準拠の青色選択状態になり、上下キー（↑/↓）で各マッチ行・ファイルヘッダー間を移動、Enter キーでファイルジャンプが可能です。
5. **完璧なソート順の保証**: 非同期 ripgrep プロセスでどのファイルが先に見つかっても、ディレクトリ階層順・自然順ファイル名順（例: carry.php が stock.php より上）に整列されます。
6. **複数文字コードの同時並行検索 & スマート品質判定**: デフォルトで EUC-JP・Shift_JIS・UTF-8 を同時に検索。文字コード品質スコアリングにより、文字化け行の排除・同一行の重複表示防止・正確な文字コードタグ自動判定を行います。
7. **VS Code アクティブアイコンテーマ連動**: Material Icon Theme や Seti など、VS Code で有効になっているファイルアイコンテーマと完全連動したアイコンを検索結果のファイル名左に表示。
8. **インデントの自動除外表示**: 深いネストのコードでも先頭のインデントを自動で省き、サイドバー上でコード内容が見やすく左詰めで表示されます（ハイライト位置も完全補正）。
9. **行番号表示のオン/オフ切り替え**: 設定から行番号のみ（`12`）の表示を自由に有効化・無効化可能。
10. **正確なキーワード選択ジャンプ**: 日本語などのマルチバイト文字が含まれていても、クリック時に1文字のズレもなく対象キーワードがハイライト・選択されます。
11. **外観カスタマイズ**: フォントサイズ、フォントファミリ、ハイライト色、文字色などを設定から自由に変更可能（即時反映）。
12. **高速ストリーミング表示 & レンダリング最適化**: 差分レンダリングと軽量DOM更新により、大量のマッチがある場合でも軽快に動作。
13. **文字コード自動適用オープン**: 検索結果をクリックすると、該当文字コードでエディタを再読み込み（`reopenWithEncoding`）してジャンプします。
14. **設定不要 (マルチプラットフォーム対応)**: VS Code 内蔵 ripgrep を自動検出し、Windows、WSL（リモート接続）、macOS、Linux で追加設定なしで即座に動作します。

---

## Usage / 使い方

1. Open the **Multi-Encoding Search** view from the Activity Bar.
2. Enter a search query and press `Enter`.
3. Click any result to open the file with its native encoding.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `multiEncodingSearch.encodings.*` | `true` | Enable/disable individual search encodings (UTF-8, EUC-JP, Shift_JIS, UTF-16LE/BE, Windows-1252, GB18030, GBK, Big5, EUC-KR). |
| `multiEncodingSearch.results.showLineNumbers` | `false` | Whether to display line numbers in search results. |
| `multiEncodingSearch.results.fontSize` | `0` | Font size (px) for search results (0 uses VS Code default). |
| `multiEncodingSearch.results.fontFamily` | `""` | Font family for search results. |
| `multiEncodingSearch.results.matchHighlightBackground` | `""` | Background color for matched search keywords (e.g. `'#ea5c0055'`). |
| `multiEncodingSearch.results.matchHighlightForeground` | `""` | Text color for matched search keywords. |
| `multiEncodingSearch.results.textColor` | `""` | Text color for search result line previews. |
| `multiEncodingSearch.results.secondaryTextColor` | `""` | Text color for line numbers and directory paths. |
| `multiEncodingSearch.rgPath` | `"rg"` | Custom path to the ripgrep binary (optional; uses bundled ripgrep by default). |

---

## License

MIT License (Copyright (c) 2026 yuitomaruyama)
