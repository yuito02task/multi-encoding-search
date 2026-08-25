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

- **Parallel Multi-Encoding Search**: Runs `ripgrep` across `EUC-JP`, `Shift_JIS` (CP932 / Windows-31J), and `UTF-8` in parallel by default, with configurable support for `UTF-16LE/BE`, `Windows-1252` (Latin-1), `GB18030`, `GBK`, `Big5`, and `EUC-KR`. Deduplicates overlapping matches automatically.
- **Native VS Code Search UX**: Results are organized cleanly by directory hierarchy, file name, and line number with standard filename + directory path styling.
- **Fast Streaming UI**: Incremental rendering and instant progress feedback stream matches into the view smoothly as they are found.
- **Auto-Reopen in Detected Encoding**: Clicking a search result reopens the editor with the matched encoding (`eucjp` / `shiftjis` / `utf8` / `utf16le` / `windows1252` / `gb18030` etc.) and highlights the exact match with perfect multi-byte character offset precision.
- **Customizable Appearance**: Customize result font size, font family, match highlight colors, and text colors directly via VS Code settings.
- **Zero Configuration**: Automatically resolves the ripgrep binary across Windows, WSL (Remote), macOS, and Linux without extra setup.
- **Native Search Options**: Supports Case Sensitivity (`Aa`), Whole Word (`\b`), Regular Expressions (`.*`), and glob filters (`files to include` / `files to exclude`).

---

## 開発の背景と特徴 (日本語)

VS Code の標準検索は `files.encoding`（通常 UTF-8）に依存しているため、EUC-JP や Shift_JIS の既存ファイルが混在するプロジェクトでは日本語検索がヒットせず、開いた際に文字化けが発生します。

本拡張機能は、上記 VS Code 公式 Issue で議論されてきた課題を解決するものです。

### 主な機能
1. **複数文字コードの同時並行検索**: デフォルトで EUC-JP・Shift_JIS・UTF-8 を同時に検索。設定により UTF-16LE/BE、Windows-1252 (Latin-1)、GB18030、GBK、Big5、EUC-KR などの国際文字コードも同時に並行検索できます。
2. **VS Code 標準準拠の並び順と表示形式**: ディレクトリ階層順・拡張子順・ファイル名順・行番号順に整列され、ファイル名とフォルダパスが見やすく整理されて表示されます。
3. **正確なキーワード選択ジャンプ**: 日本語などのマルチバイト文字が含まれていても、クリック時に1文字のズレもなく対象キーワードがハイライト・選択されます。
4. **外観カスタマイズ**: フォントサイズ、フォントファミリ、ハイライト色、文字色などを設定から自由に変更可能（即時反映）。
5. **高速ストリーミング表示**: 検索中にヒットしたファイルや行がリアルタイムに順次表示され、検索件数も動的にカウントアップされます。
6. **文字コード自動適用オープン**: 検索結果をクリックすると、該当文字コードでエディタを再読み込み（`reopenWithEncoding`）してジャンプします。
7. **設定不要 (マルチプラットフォーム対応)**: VS Code 内蔵 ripgrep を自動検出し、Windows、WSL（リモート接続）、macOS、Linux で追加設定なしで即座に動作します。

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
