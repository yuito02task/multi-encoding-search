/**
 * EUC-JP ワークスペース検索拡張機能 - 型定義モジュール
 */

/** サポートする文字エンコーディング一覧 */
export type SupportedEncoding =
  | 'utf-8'
  | 'euc-jp'
  | 'shift_jis'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1252'
  | 'gb18030'
  | 'gbk'
  | 'big5'
  | 'euc-kr';

/**
 * 検索オプションの定義
 */
export interface SearchOptions {
  /** 検索文字列 */
  pattern: string;
  /** 正規表現を使用するかどうか */
  isRegexp: boolean;
  /** 大文字と小文字を区別するかどうか */
  isCaseSensitive: boolean;
  /** 単語単位で検索するかどうか */
  isWordMatch: boolean;
  /** 検索対象に含めるファイルパターン (glob) */
  includePattern?: string;
  /** 検索対象から除外するファイルパターン (glob) */
  excludePattern?: string;
  /** 検索対象の文字コード一覧 */
  targetEncodings?: SupportedEncoding[];
}

/**
 * 1行の中でのマッチ位置情報
 */
export interface Submatch {
  /** マッチした文字列 */
  matchText: string;
  /** 行内での開始位置 (0始まり) */
  start: number;
  /** 行内での終了位置 (0始まり) */
  end: number;
}

/**
 * 1件の検索マッチ結果
 */
export interface SearchMatch {
  /** 行番号 (1始まり) */
  lineNumber: number;
  /** 列番号 (1始まり) */
  columnNumber: number;
  /** 該当行のテキストプレビュー */
  lineText: string;
  /** 行内のマッチ位置リスト */
  submatches: Submatch[];
  /** ヒットした文字コード */
  encoding: SupportedEncoding;
}

/**
 * ファイルごとの検索結果グループ
 */
export interface FileSearchResult {
  /** ファイルの絶対パス */
  filePath: string;
  /** ワークスペースからの相対パス */
  relativePath: string;
  /** このファイル内のマッチ一覧 */
  matches: SearchMatch[];
  /** 主な文字エンコーディング */
  primaryEncoding?: SupportedEncoding;
}

/**
 * Webview から拡張機能ホストへ送信されるメッセージの型定義
 */
export type WebviewMessage =
  | { command: 'search'; options: SearchOptions }
  | { command: 'cancel' }
  | { command: 'openFile'; filePath: string; line: number; column: number; length: number; encoding: SupportedEncoding };

/**
 * 拡張機能ホストから Webview へ送信されるメッセージの型定義
 */
export type ExtensionMessage =
  | { command: 'searchStart' }
  | { command: 'searchProgress'; results: FileSearchResult[]; totalMatches: number; totalFiles: number; isTruncated: boolean }
  | { command: 'searchComplete'; totalMatches: number; totalFiles: number; isTruncated: boolean }
  | { command: 'searchError'; errorMessage: string; errorType?: 'rgNotFound' | 'invalidRegex' | 'other' }
  | { command: 'searchCancelled' };
