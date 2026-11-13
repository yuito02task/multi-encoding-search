# Multi-Encoding Search — VS Code 複数文字コード検索・Grep検索 拡張機能 (UTF-8 / Shift_JIS / EUC-JP / EUC-KR / UTF-16 / GB18030 / Big5)

**【VSCode 検索 文字コード 拡張機能】VS Code 標準のファイル横断検索（`Ctrl+Shift+F`）の操作性・UIをそのままに、Shift_JIS (SJIS / CP932)・EUC-JP・UTF-8・EUC-KR 等の複数文字コード混在環境へ対応させた完全な代替検索拡張機能（置換機能を除く）です。**  
**A drop-in replacement for VS Code's native workspace search (`Ctrl+Shift+F`, except replace) that searches across mixed character encodings (UTF-8, Shift_JIS, EUC-JP, EUC-KR, UTF-16, Windows-1252, GB18030, Big5) simultaneously without changing `files.encoding` or causing mojibake.**

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/yuitomaruyama.multi-encoding-search?style=flat-square&color=blue)](https://marketplace.visualstudio.com/items?itemName=yuitomaruyama.multi-encoding-search)
[![GitHub Repository](https://img.shields.io/badge/GitHub-yuito02task%2Fmulti--encoding--search-181717?style=flat-square&logo=github)](https://github.com/yuito02task/multi-encoding-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

---

## 解決する課題：なぜ VS Code 標準の検索（Ctrl+Shift+F）では文字コード混在ファイルを検索できないのか？

VS Code 標準のワークスペース検索（ファイル内検索 / 全文検索 / Grep検索）は、設定された単一の文字コード（`files.encoding`、デフォルトは `UTF-8`）でのみ検索を行う仕様になっています。そのため、PHP・Perl・C/C++・COBOL・Java・レガシーWebシステムや業務システムなど、**UTF-8 と Shift_JIS (SJIS / CP932) や EUC-JP、EUC-KR などのファイルが混在するプロジェクト**では以下の深刻な問題が発生します。

- **日本語などのマルチバイト文字が検索に一切ヒットしない**: `UTF-8` 設定のまま検索すると、`Shift_JIS` や `EUC-JP` のファイル内にある日本語キーワードがすべて無視される。
- **検索結果からファイルを開くと文字化け（Mojibake）する**: 毎回手動で「エンコーディング付きで再度開く (Reopen with Encoding)」を実行しなければならない。
- **`files.encoding` を変更すると別のファイルが検索できなくなる**: 設定を `shiftjis` や `eucjp` に変更すると、今度は `UTF-8` のファイルが文字化けして検索に引っかからなくなる。

これらは VS Code 公式リポジトリでも長年にわたり未解決の重要課題（Issue）として議論されています：
- [microsoft/vscode#127896](https://github.com/microsoft/vscode/issues/127896) — *Support searching in multiple encodings (複数文字コードでの検索サポート)*
- [microsoft/vscode#256502](https://github.com/microsoft/vscode/issues/256502) — *Search with specific file encoding (特定の文字コードを指定した検索)*
- [microsoft/vscode#23570](https://github.com/microsoft/vscode/issues/23570) — *Support searching in non-UTF-8 files (非UTF-8ファイルの検索サポート)*
- [VS Code Search Issues Wiki](https://github.com/microsoft/vscode/wiki/Search-Issues)

**Multi-Encoding Search** は、これらの課題を根本から解決し、**「置換機能を除く VS Code 標準検索の操作性と機能をそのままに、文字コード混在環境へ完全対応させた代替ツール」** として開発された VS Code 拡張機能です。

---

## 従来の文字コード検索拡張機能（Grep Multi Encode / vscode-grep-encoding-search 等）との違い

「**VSCode 検索 文字コード 拡張機能**」や「**VSCode Shift_JIS EUC-JP Grep 検索**」を探している方にとって、従来の拡張機能（`Grep Multi Encode` や `vscode-grep-encoding-search` 等）と比較して **Multi-Encoding Search** には以下の決定的な優位性があります。

| 比較項目 | Multi-Encoding Search (本拡張機能) | 従来の Grep 系拡張機能 (`Grep Multi Encode` 等) | VS Code 標準検索 (`Ctrl+Shift+F`) |
|---|---|---|---|
| **複数文字コードの同時一括検索** | **◎ 対応** (UTF-8 / Shift_JIS / EUC-JP / EUC-KR 等を自動並行検索) | ○ 対応 | × 非対応 (`files.encoding` の1種類のみ) |
| **文字化けなしでの自動オープン** | **◎ 対応** (判定された文字コードで自動再読み込み＆該当箇所を選択) | △ エディタ側で文字化けする場合あり | × 非UTF-8ファイルが文字化けする |
| **VS Code 標準検索と同じサイドバー UI** | **◎ 完全準拠** (標準検索の操作感そのままのドロップイン代替) | × 独自コマンド入力や別パネル表示 | ◎ 標準UI |
| **ツリー表示 / リスト表示・折りたたみ** | **◎ 対応** (ツリー/リスト切替・すべて折りたたむ・状態維持) | × 非対応 | ◎ 対応 |
| **PCRE2 正規表現 (先読み/後読み)・複数行検索** | **◎ 対応** (`(?<!::)` 等の look-around・`Shift+Enter` 複数行検索) | × 制限あり | ◎ 対応 |
| **詳細フィルタ (Include/Exclude・開いているエディタ・変更ファイル限定)** | **◎ 対応** (`search.exclude` / `.gitignore` 連動・開いているタブ限定・Git変更ファイル限定検索) | △ 簡易指定のみ | ◎ 対応 |
| **事前設定・外部ツール導入** | **◎ 不要 (Zero Config)** (VS Code内蔵 ripgrep を自動検出して即動作) | △ 外部 grep パスや文字コード設定が必要 | ◎ 不要 |

---

## 主な特徴・機能一覧 (Features)

1. **複数文字コードの自動並行検索 & 文字化け防止オープン**
   - **UTF-8, EUC-JP, Shift_JIS (CP932 / Windows-31J), EUC-KR, UTF-16 (LE/BE), Windows-1252, GB18030, GBK, Big5** を同時に自動並行検索。
   - 検索結果をクリックすると、実ファイルのバイナリ解析と文字コード品質スコアリングにより特定された正しい文字コードを自動適用（`reopenWithEncoding`）してエディタを開き、マルチバイト文字でもズレなく該当箇所をハイライト選択します。
   - 不正デコードによる文字化け行（`U+FFFD` 等）の除外や、複数エンコーディング間での同一行の重複ヒット排除を自動で行います。

2. **VS Code 標準検索（Ctrl+Shift+F）と同等の操作性・UI/UX**
   - **ビューヘッダーの 5 つのアクションボタン**: 「最新の情報に更新」「検索結果のクリア」「ツリーとして表示 / リストとして表示」「新しい検索エディターを開く」「すべて折りたたんで表示します。 / すべて展開」を標準搭載。
   - **タブ切替・再起動時の完全な状態維持**: アクティビティバーでエクスプローラーやソース管理など他のタブに切り替えて戻った際も、検索結果・ツリー/リスト表示・「すべて折りたたんで表示」や個別の折りたたみ状態・選択行・スクロール位置・入力内容を完全に維持します。
   - **キーボードナビゲーション**: 検索結果一覧で上下キー（`↑` / `↓`）による連続プレビュー移動、左右キー（`←` / `→`）でのフォルダ・ファイル開閉、`Enter` キーでのエディタフォーカス移動、`Ctrl+C` での行テキスト/パスコピーに対応。
   - **3つの入力欄のツールチップ & 検索履歴**: 検索キーワード・含めるファイル・除外するファイルの各入力欄で VS Code 標準準拠のツールチップ表示と、上下キー（`⇅`）による過去50件の入力履歴呼び出しに対応。
   - **詳細検索オプション**: 「含めるファイル」欄に「開いているエディターでのみ検索」および「変更されたファイルのみ検索する (ソース管理)」トグルボタン、「除外するファイル」欄に「除外設定（`.gitignore` / `search.exclude` / `files.exclude`）を使用してファイルを無視」トグルボタンを標準搭載。
   - **複数行検索 & PCRE2 正規表現サポート**: `Shift + Enter` やコピペによる複数行検索、および `--pcre2` による肯定/否定の先読み・後読み（例: `(?<!::)number_format\(`）や後方参照を含む高度な正規表現検索に対応。
   - **ショートカット起動**: タブを直接開くショートカット（デフォルト: `Ctrl+Shift+Alt+F` / Mac: `Cmd+Shift+Alt+F`、キーボードショートカット設定から自由に変更可能）と、ツールチップでのショートカット併記に対応。

3. **設定不要で即座に動作 (Zero Configuration)**
   - VS Code 本体に同梱されている `ripgrep (rg)` を自動検出するため、Windows、WSL（Remote）、macOS、Linux（SSH / Containers）のあらゆる環境で追加インストールや設定なしにすぐ使えます。

---

## 対応文字コード一覧 (Supported Encodings)

設定画面（`multiEncodingSearch.encodings.*`）から、検索対象とする文字コードを個別にオン/オフ可能です（初期状態ではすべて有効）。

| 文字コード (Encoding) | 設定キー | 主な用途・対象ファイルの例 |
|---|---|---|
| **UTF-8** | `multiEncodingSearch.encodings.utf8` | 現代の標準ソースコード全般 |
| **Shift_JIS (SJIS / CP932 / Windows-31J)** | `multiEncodingSearch.encodings.shiftjis` | 日本語 Windows 標準、レガシー業務システム、CSV、VB/C/C++/Java/PHP 等 |
| **EUC-JP** | `multiEncodingSearch.encodings.eucjp` | 日本語 Unix / Linux サーバー資産、レガシー PHP / Perl / シェルスクリプト / C 等 |
| **UTF-16 LE / UTF-16 BE** | `multiEncodingSearch.encodings.utf16le` / `utf16be` | Windows リソースファイル (`.rc`, `.reg`)、ログファイル、Unicode テキスト |
| **EUC-KR (CP949)** | `multiEncodingSearch.encodings.euckr` | 韓国語レガシーシステム・ソースコード（日本語混在ファイルにも対応） |
| **GB18030 / GBK** | `multiEncodingSearch.encodings.gb18030` / `gbk` | 中国語（簡体字）標準およびレガシー資産 |
| **Big5** | `multiEncodingSearch.encodings.big5` | 中国語（繁体字・台湾/香港）レガシー資産 |
| **Windows-1252 (Latin-1)** | `multiEncodingSearch.encodings.windows1252` | 欧米（西ヨーロッパ言語）のレガシーファイル |

---

## 使い方 (Usage)

1. VS Code 左側のアクティビティバーにある **虫眼鏡＋地球アイコン（マルチ文字コード検索 / Multi-Encoding Search）** をクリックするか、ショートカット **`Ctrl+Shift+Alt+F`**（Mac は `Cmd+Shift+Alt+F`）を押してビューを開きます。
2. 検索入力欄に探したい文字列（日本語や正規表現、複数行テキストも可）を入力すると、ワークスペース内の複数文字コードファイルからリアルタイムで自動検索されます。
3. 検索結果の行をクリックすると、そのファイルの文字コード（`EUC-JP` や `SJIS` 等）が自動適用された状態でエディタが開き、文字化けすることなく該当箇所へジャンプします。

---

## Overview (English)

In VS Code, native workspace search (`Ctrl+Shift+F`) relies on a single global encoding (`files.encoding`, default `UTF-8`). In projects containing legacy or mixed-encoding files (such as PHP, Perl, C/C++, or enterprise codebases with **EUC-JP, Shift_JIS / CP932, EUC-KR, GB18030, Big5, or UTF-16**), non-UTF-8 files fail to match multi-byte queries, and opening matched files results in garbled text (*mojibake*).

This addresses long-standing VS Code issues:
- [microsoft/vscode#127896](https://github.com/microsoft/vscode/issues/127896) — *Support searching in multiple encodings*
- [microsoft/vscode#256502](https://github.com/microsoft/vscode/issues/256502) — *Search with specific file encoding*
- [microsoft/vscode#23570](https://github.com/microsoft/vscode/issues/23570) — *Support searching in non-UTF-8 files*
- [VS Code Search Issues Wiki](https://github.com/microsoft/vscode/wiki/Search-Issues)

**Multi-Encoding Search is a modern, drop-in replacement for VS Code's native search (excluding replace) that solves mixed-encoding search seamlessly with zero configuration.**

### Key Capabilities

1. **Parallel Multi-Encoding Search & Auto-Reopen Without Mojibake**
   - Simultaneously searches files in **UTF-8, Shift_JIS (CP932), EUC-JP, EUC-KR, UTF-16 (LE/BE), Windows-1252, GB18030, GBK, and Big5** in parallel.
   - Automatically reopens clicked files in their detected encoding with exact multi-byte offset highlighting.
   - Binary inspection and character quality scoring eliminate garbled lines and duplicate matches across encodings.

2. **Native VS Code Search UI/UX & Full State Preservation**
   - **View Title Bar Actions**: Refresh, Clear Search Results, View as Tree / View as List, Open New Search Editor, and Collapse All / Expand All.
   - **Complete State Preservation Across Tab Switches**: Preserves search results, tree/list view mode, Collapse All and individual folder/file collapsed states, selected item, and scroll position when switching between Activity Bar tabs.
   - **Keyboard Navigation & Search History**: Up/Down arrow keys for live editor preview synchronization, Left/Right arrow keys to collapse/expand, and persistent search/include/exclude history (`⇅`).
   - **PCRE2 Regular Expressions & Multi-line Search**: Supports look-ahead, look-behind (e.g., `(?<!::)number_format\(`), backreferences (`--pcre2`), and `Shift + Enter` multi-line queries.
   - **Search Details**: Include/Exclude glob filters with "Search only in Open Editors", "Search only in Modified Files (Source Control)", and "Use Exclude Settings and Ignore Files" toggles.

3. **Zero Configuration**
   - Automatically discovers VS Code's bundled `ripgrep` binary across Windows, WSL, macOS, and Linux.

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

## Release Notes / 更新履歴

- **v1.5.2**: 詳細検索の「含めるファイル」入力欄に「変更されたファイルのみ検索する (ソース管理) / Search only in Modified Files (Source Control)」トグルボタンを追加（VS Code Git 拡張機能 API および Git CLI 連動）。
- **v1.5.1**: アクティビティバーのタブ切替時における折りたたみ状態（「すべて折りたたんで表示」および個別フォルダ/ファイルの開閉状態）・選択行・スクロール位置・コンテキストキーの完全維持に対応。Marketplace / Google 検索 / AI 検索向けのドキュメント・キーワード最適化。
- **v1.5.0**: 3つの入力欄のツールチップ標準準拠、「詳細検索の切り替え」ボタンの非強調化、ビューヘッダーの5つのアクションボタン（更新・クリア・ツリー/リスト表示切替・新しい検索エディターを開く・すべて折りたたむ/展開）とショートカット（`Ctrl+Shift+Alt+F`）実装、PCRE2 正規表現（先読み・後読み）対応。
- **v1.4.0 - v1.4.3**: EUC-KR 等の文字コード判定強化、初回起動の高速化、検索結果一覧のホバー・選択スタイルや履歴ナビゲーションの VS Code 標準準拠化。

---

## License

MIT License (Copyright (c) 2026 yuitomaruyama)
