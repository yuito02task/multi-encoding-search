import * as childProcess from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { SearchOptions, FileSearchResult, SearchMatch, SupportedEncoding } from './types';

/** 検索結果の最大表示件数 */
const MAX_MATCH_LIMIT = 10000;

/** デフォルトで自動検索する対象文字コード一覧 (日本語主要文字コード) */
const DEFAULT_TARGET_ENCODINGS: SupportedEncoding[] = ['utf-8', 'euc-jp', 'shift_jis'];

/**
 * ripgrep の JSON 出力におけるマッチデータ構造
 */
interface RgMatchData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
  submatches: Array<{
    match: { text: string };
    start: number;
    end: number;
  }>;
}

/**
 * ripgrep プロセスを実行し、結果をパースするランナークラス
 */
export class RipgrepRunner {
  private activeProcesses: childProcess.ChildProcess[] = [];
  private isCancelledByUser = false;

  /**
   * 複数エンコーディングで並行検索を実行する
   * @param rgPath ripgrep実行ファイルのパス
   * @param workspaceFolders 検索対象のワークスペースルートパス一覧
   * @param options 検索条件オプション
   * @param onProgress 検索結果が追加されたときのコールバック
   * @param onComplete 検索完了時のコールバック
   * @param onError エラー発生時のコールバック
   */
  public search(
    rgPath: string,
    workspaceFolders: string[],
    options: SearchOptions,
    onProgress: (results: FileSearchResult[], totalMatches: number, totalFiles: number, isTruncated: boolean) => void,
    onComplete: (totalMatches: number, totalFiles: number, isTruncated: boolean) => void,
    onError: (errorMessage: string, errorType?: 'rgNotFound' | 'invalidRegex' | 'other') => void
  ): void {
    // 実行中のプロセスがあれば先にキャンセル
    this.cancel();

    this.isCancelledByUser = false;

    // 検索対象の文字コード一覧 (指定がなければデフォルトの日本語主要3文字コード)
    const encodingsToSearch: SupportedEncoding[] =
      options.targetEncodings && options.targetEncodings.length > 0
        ? options.targetEncodings
        : DEFAULT_TARGET_ENCODINGS;

    // 検索結果を蓄積するマップ (ファイルパス -> FileSearchResult)
    const fileResultMap = new Map<string, FileSearchResult>();
    // 重複防止用セット (filePath:lineNumber:columnNumber -> true)
    const seenMatchKeys = new Set<string>();

    let totalMatchCount = 0;
    let isTruncated = false;
    let completedCount = 0;
    let hasReportedError = false;

    // 段階的な進捗更新のためのスロットリング用タイマー
    let progressUpdateTimer: NodeJS.Timeout | null = null;
    let hasNotifiedInitialProgress = false;

    const notifyProgress = () => {
      // 最初のヒット時は待ち時間なしで即座にUIに反映して体感速度を高める
      if (!hasNotifiedInitialProgress) {
        hasNotifiedInitialProgress = true;
        const results = this.getSortedResults(fileResultMap);
        onProgress(results, totalMatchCount, results.length, isTruncated);
        return;
      }

      if (progressUpdateTimer) {
        return;
      }

      progressUpdateTimer = setTimeout(() => {
        progressUpdateTimer = null;
        const results = this.getSortedResults(fileResultMap);
        onProgress(results, totalMatchCount, results.length, isTruncated);
      }, 60);
    };

    // 各エンコーディングに対して ripgrep プロセスを起動
    for (const encoding of encodingsToSearch) {
      const args = this.buildRipgrepArgs(options, workspaceFolders, encoding);

      try {
        const proc = childProcess.spawn(rgPath, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        this.activeProcesses.push(proc);

        // stdout を行単位で読み込む
        const rl = readline.createInterface({
          input: proc.stdout,
          crlfDelay: Infinity
        });

        rl.on('line', (line: string) => {
          if (!line.trim() || isTruncated) {
            return;
          }

          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match' && parsed.data) {
              const matchData = parsed.data as RgMatchData;
              const added = this.handleMatchData(
                matchData,
                workspaceFolders,
                fileResultMap,
                seenMatchKeys,
                encoding
              );

              if (added) {
                totalMatchCount++;

                // 上限件数に達した場合は全プロセスを停止
                if (totalMatchCount >= MAX_MATCH_LIMIT) {
                  isTruncated = true;
                  this.cancel();
                }

                notifyProgress();
              }
            }
          } catch (parseError) {
            console.warn('ripgrep JSON パース失敗:', parseError, line);
          }
        });

        // 標準エラー出力の収集
        let stderrOutput = '';
        proc.stderr.on('data', (chunk: Buffer) => {
          stderrOutput += chunk.toString();
        });

        // 起動エラー
        proc.on('error', (err: NodeJS.ErrnoException) => {
          if (hasReportedError) {
            return;
          }
          hasReportedError = true;

          if (progressUpdateTimer) {
            clearTimeout(progressUpdateTimer);
          }

          if (err.code === 'ENOENT') {
            onError(
              `ripgrep が見つかりませんでした (${rgPath})。設定「multiEncodingSearch.rgPath」で正しいパスを指定してください。`,
              'rgNotFound'
            );
          } else {
            onError(`ripgrep の起動中にエラーが発生しました: ${err.message}`, 'other');
          }
        });

        // プロセス終了時
        proc.on('close', (code: number | null) => {
          completedCount++;

          // 異常終了時のエラーハンドリング (まだ報告していない場合)
          if (!hasReportedError && !this.isCancelledByUser && code !== null && code > 1 && !isTruncated) {
            if (code === -4057 || code === -2) {
              hasReportedError = true;
              onError(
                `ripgrep (rg) が見つかりませんでした。ripgrep をインストールするか、VS Code設定「multiEncodingSearch.rgPath」で rg.exe のフルパスを指定してください。`,
                'rgNotFound'
              );
              return;
            }

            if (stderrOutput.includes('regex parse error') || stderrOutput.includes('syntax error')) {
              hasReportedError = true;
              onError(stderrOutput.trim(), 'invalidRegex');
              return;
            }
          }

          // 全エンコーディングの検索が完了した場合
          if (completedCount >= encodingsToSearch.length) {
            if (progressUpdateTimer) {
              clearTimeout(progressUpdateTimer);
            }

            this.activeProcesses = [];

            // すでにエラーが通知されているか、ユーザーキャンセル時は完了通知を送らない
            if (this.isCancelledByUser || hasReportedError) {
              return;
            }

            const results = this.getSortedResults(fileResultMap);
            onProgress(results, totalMatchCount, results.length, isTruncated);
            onComplete(totalMatchCount, results.length, isTruncated);
          }
        });
      } catch (spawnException: any) {
        if (!hasReportedError) {
          hasReportedError = true;
          onError(`検索プロセスの起動に失敗しました: ${spawnException.message}`, 'other');
        }
      }
    }
  }

  /**
   * 結果マップからファイルパス順・行番号順にソートされた配列を取得する
   */
  private getSortedResults(fileResultMap: Map<string, FileSearchResult>): FileSearchResult[] {
    const results = Array.from(fileResultMap.values());

    // 各ファイル内のマッチ行を行番号・列番号順にソート
    for (const file of results) {
      file.matches.sort((a, b) => {
        if (a.lineNumber !== b.lineNumber) {
          return a.lineNumber - b.lineNumber;
        }
        return a.columnNumber - b.columnNumber;
      });
    }

    // ファイル同士を「ディレクトリ階層順 ＞ 拡張子順 ＞ ファイル名順」でソート
    results.sort((a, b) => {
      // 1. ディレクトリパスの比較
      if (a.dirPath !== b.dirPath) {
        const dirCompare = a.dirPath.localeCompare(b.dirPath, undefined, { numeric: true, sensitivity: 'base' });
        if (dirCompare !== 0) {
          return dirCompare;
        }
      }

      // 2. ディレクトリが同一ならファイル拡張子で比較
      const extA = path.extname(a.fileName).toLowerCase();
      const extB = path.extname(b.fileName).toLowerCase();
      if (extA !== extB) {
        const extCompare = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: 'base' });
        if (extCompare !== 0) {
          return extCompare;
        }
      }

      // 3. 拡張子も同一ならファイル名で比較
      return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
    });

    return results;
  }

  /**
   * 実行中のすべての検索プロセスを強制終了 (キャンセル) する
   */
  public cancel(): void {
    this.isCancelledByUser = true;
    for (const proc of this.activeProcesses) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }
    this.activeProcesses = [];
  }

  /**
   * ripgrep の起動引数配列を構築する
   */
  private buildRipgrepArgs(
    options: SearchOptions,
    workspaceFolders: string[],
    encoding: SupportedEncoding
  ): string[] {
    const args: string[] = [
      '--json',
      '--line-number',
      '--column',
      '--color=never',
      '--encoding',
      encoding
    ];

    // 正規表現 or 固定文字列
    if (options.isRegexp) {
      // 正規表現モード
    } else {
      args.push('--fixed-strings');
    }

    // 大文字小文字の区別
    if (options.isCaseSensitive) {
      args.push('--case-sensitive');
    } else {
      args.push('--ignore-case');
    }

    // 単語単位
    if (options.isWordMatch) {
      args.push('--word-regexp');
    }

    // Files to include (glob)
    if (options.includePattern && options.includePattern.trim()) {
      const includeGlobs = this.normalizeGlobPatterns(options.includePattern, false);
      for (const pattern of includeGlobs) {
        args.push('--glob', pattern);
      }
    }

    // Files to exclude (glob)
    if (options.excludePattern && options.excludePattern.trim()) {
      const excludeGlobs = this.normalizeGlobPatterns(options.excludePattern, true);
      for (const pattern of excludeGlobs) {
        args.push('--glob', pattern);
      }
    }

    // オプションと検索文字列の境界
    args.push('--');

    // 検索パターン文字列
    args.push(options.pattern);

    // 検索対象のワークスペースフォルダ
    for (const folder of workspaceFolders) {
      args.push(folder);
    }

    return args;
  }

  /**
   * VS Code 標準ライクな glob パターン正規化
   * @param input ユーザー入力文字列 (カンマ区切り)
   * @param isExclude exclude の場合は否定 glob (!) を付与
   */
  private normalizeGlobPatterns(input: string, isExclude: boolean): string[] {
    const rawPatterns = input
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const result: string[] = [];

    for (let raw of rawPatterns) {
      // バックスラッシュをスラッシュに置換
      raw = raw.replace(/\\/g, '/');

      // 既に否定記号がついている場合は除去して後で統一処理
      let negated = false;
      if (raw.startsWith('!')) {
        negated = true;
        raw = raw.substring(1).trim();
      }

      // 先頭の ./ を除去
      if (raw.startsWith('./')) {
        raw = raw.substring(2);
      }

      let globPattern = raw;

      // ワイルドカード (* や ?) が含まれていない場合
      if (!raw.includes('*') && !raw.includes('?')) {
        // 末尾のスラッシュを除去
        const cleanName = raw.replace(/\/+$/, '');
        // ファイル拡張子らしきもの (例: .php, .js)
        if (cleanName.startsWith('.')) {
          globPattern = `**/*${cleanName}`;
        } else {
          // フォルダ名指定 (例: src, vendor) -> **/src/**
          globPattern = `**/${cleanName}/**`;
        }
      } else {
        // ワイルドカードが含まれる場合 (例: *.php)
        if (!raw.startsWith('**/') && !raw.startsWith('/')) {
          // 例: *.php -> **/*.php, src/*.php -> **/src/*.php
          globPattern = `**/${raw}`;
        }
      }

      // exclude または入力が否定指定だった場合、! を付与
      if (isExclude || negated) {
        result.push(`!${globPattern}`);
      } else {
        result.push(globPattern);
      }
    }

    return result;
  }

  /**
   * 1件の ripgrep マッチデータを FileSearchResult にマッピング・重複排除して格納する
   * @returns 新規に追加された場合は true
   */
  private handleMatchData(
    matchData: RgMatchData,
    workspaceFolders: string[],
    fileResultMap: Map<string, FileSearchResult>,
    seenMatchKeys: Set<string>,
    encoding: SupportedEncoding
  ): boolean {
    const filePath = matchData.path.text;
    const lineNumber = matchData.line_number;

    // 行テキストの改行文字を削除
    const rawLineText = matchData.lines.text.replace(/\r?\n$/, '');

    // 先頭のインデント (空白・タブ) をトリムしてコード内容を見やすくする (VS Code 標準検索と同様)
    const indentMatch = rawLineText.match(/^[ \t]+/);
    const leadingIndentLength = indentMatch ? indentMatch[0].length : 0;
    const cleanLineText = leadingIndentLength > 0 ? rawLineText.substring(leadingIndentLength) : rawLineText;

    // ripgrep のバイトオフセットを JavaScript / VS Code の文字インデックス (UTF-16) に変換
    const convertedSubmatches: Array<{ matchText: string; start: number; end: number }> = [];
    let charSearchCursor = 0;
    let originalFirstCol = 1;

    for (let i = 0; i < matchData.submatches.length; i++) {
      const sub = matchData.submatches[i];
      const matchText = sub.match.text;

      // 元の行での出現位置 (ジャンプ用列番号の計算)
      if (i === 0) {
        const rawIdx = rawLineText.indexOf(matchText);
        originalFirstCol = rawIdx !== -1 ? rawIdx + 1 : sub.start + 1;
      }

      // トリム後の表示用行テキスト内での出現位置を検索 (行内の前のマッチ位置以降から探す)
      const foundIndex = cleanLineText.indexOf(matchText, charSearchCursor);

      if (foundIndex !== -1) {
        convertedSubmatches.push({
          matchText,
          start: foundIndex,
          end: foundIndex + matchText.length
        });
        charSearchCursor = foundIndex + matchText.length;
      } else {
        // 万が一 indexOf で見つからない場合のフォールバック (インデント分を安全に減算)
        const fallbackStart = Math.max(0, sub.start - leadingIndentLength);
        const fallbackEnd = Math.max(fallbackStart + matchText.length, sub.end - leadingIndentLength);
        convertedSubmatches.push({
          matchText,
          start: fallbackStart,
          end: fallbackEnd
        });
      }
    }

    // 列番号はファイルオープンジャンプ用の元行 1 始まり文字インデックス
    const columnNumber = originalFirstCol;

    // 重複判定キー (同一ファイル・行・列での重複を排除)
    const matchKey = `${filePath}:${lineNumber}:${columnNumber}`;
    if (seenMatchKeys.has(matchKey)) {
      return false;
    }
    seenMatchKeys.add(matchKey);

    const relativePath = this.getRelativePath(filePath, workspaceFolders);

    let fileResult = fileResultMap.get(filePath);
    if (!fileResult) {
      // ファイル名とディレクトリパスを分解
      const parsedPath = path.posix.parse(relativePath);
      const fileName = parsedPath.base;
      const dirPath = parsedPath.dir === '.' ? '' : parsedPath.dir;

      fileResult = {
        filePath,
        relativePath,
        fileName,
        dirPath,
        matches: [],
        primaryEncoding: encoding
      };
      fileResultMap.set(filePath, fileResult);
    }

    const searchMatch: SearchMatch = {
      lineNumber,
      columnNumber,
      lineText: cleanLineText,
      submatches: convertedSubmatches,
      encoding
    };

    fileResult.matches.push(searchMatch);
    return true;
  }

  /**
   * ワークスペースルートに対する相対パスを算出する
   */
  private getRelativePath(filePath: string, workspaceFolders: string[]): string {
    for (const folder of workspaceFolders) {
      if (filePath.startsWith(folder)) {
        const rel = path.relative(folder, filePath);
        return rel.replace(/\\/g, '/');
      }
    }
    return filePath.replace(/\\/g, '/');
  }
}
