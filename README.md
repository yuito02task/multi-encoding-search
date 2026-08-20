# Multi-Encoding Search (EUC-JP / Shift_JIS / UTF-8)

A VS Code extension that enables simultaneous workspace search across **EUC-JP, Shift_JIS, and UTF-8** files, and opens matched files in their detected encoding.

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

- **Parallel Multi-Encoding Search**: Runs `ripgrep` across `EUC-JP`, `Shift_JIS`, and `UTF-8` in parallel and deduplicates overlapping matches.
- **Auto-Reopen in Detected Encoding**: Clicking a search result reopens the editor with the matched encoding (`eucjp` / `shiftjis` / `utf8`) and jumps to the exact line/column without modifying `files.encoding`.
- **Zero Configuration**: Bundles `@vscode/ripgrep` and automatically resolves the ripgrep binary across Windows, WSL, macOS, and Linux.
- **Native Search Options**: Supports Case Sensitivity (`Aa`), Whole Word (`\b`), Regular Expressions (`.*`), and glob filters (`files to include` / `files to exclude`).

---

## 開発の背景と特徴 (日本語)

VS Code の標準検索は `files.encoding`（通常 UTF-8）に依存しているため、EUC-JP や Shift_JIS の既存ファイルが混在するプロジェクトでは日本語検索がヒットせず、開いた際に文字化けが発生します。

本拡張機能は、上記 VS Code 公式 Issue で議論されてきた課題を解決するものです。

### 主な機能
1. **複数文字コードの同時並行検索**: EUC-JP・Shift_JIS・UTF-8 を 1 つのクエリで同時に検索し、重複を自動排除して結果を表示します。
2. **文字コード自動適用オープン**: 検索結果をクリックすると、該当文字コードでエディタを再読み込み（`reopenWithEncoding`）してジャンプします。
3. **設定不要 (マルチプラットフォーム対応)**: `@vscode/ripgrep` を同梱し、Windows、WSL（リモート接続）、macOS、Linux で追加設定なしで即座に動作します。

---

## Usage / 使い方

1. Open the **Multi-Encoding Search** view from the Activity Bar.
2. Enter a search query and press `Enter`.
3. Click any result to open the file with its native encoding.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `multiEncodingSearch.rgPath` | `"rg"` | Custom path to the ripgrep binary (optional; uses bundled ripgrep by default). |

---

## License

MIT License (Copyright (c) 2026 yuitomaruyama)
