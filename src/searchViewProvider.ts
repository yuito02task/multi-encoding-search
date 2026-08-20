import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RipgrepRunner } from './ripgrepRunner';
import { SearchOptions, WebviewMessage, ExtensionMessage, SupportedEncoding } from './types';

/**
 * マルチ文字コード検索のサイドバー WebviewView プロバイダー
 */
export class EucjpSearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'multiEncodingSearch.searchView';

  private view?: vscode.WebviewView;
  private readonly runner: RipgrepRunner;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.runner = new RipgrepRunner();
  }

  /**
   * 使用する ripgrep (rg) の実行ファイルパスを解決する (Windows / WSL / Linux / macOS 対応)
   */
  private resolveRipgrepPath(): string {
    const config = vscode.workspace.getConfiguration('multiEncodingSearch');
    const userConfigPath = config.get<string>('rgPath', 'rg');

    // 1. ユーザーが明示的にデフォルト ('rg') 以外のカスタムパスを指定している場合は最優先
    if (userConfigPath && userConfigPath !== 'rg' && userConfigPath.trim().length > 0) {
      return userConfigPath;
    }

    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'rg.exe' : 'rg';

    // 2. VS Code 本体に同梱されている ripgrep の探索 (WSL, Remote, Desktop すべてで最優先)
    // VS Code は各プラットフォーム(Linux/Mac/Windows)ごとの正規 ripgrep を必ず内蔵しています
    const appRoot = vscode.env.appRoot;
    if (appRoot) {
      const vscodeCandidates = [
        path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules', 'vscode-ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules', '@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin', binaryName),
        path.join(appRoot, '..', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
        path.join(appRoot, '..', 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', binaryName)
      ];

      for (const candidate of vscodeCandidates) {
        if (this.isValidExecutable(candidate)) {
          return candidate;
        }
      }
    }

    // 3. 拡張機能自身のディレクトリ内のバイナリ探索 (現在のプラットフォームに合致するもののみ)
    const extFsPath = this.extensionUri.fsPath;
    const extensionCandidates = [
      path.join(extFsPath, 'node_modules', '@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin', binaryName),
      path.join(extFsPath, 'node_modules', `@vscode/ripgrep-${process.platform}-${process.arch}`, 'bin', binaryName),
      path.join(extFsPath, 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      path.join(extFsPath, 'node_modules', 'vscode-ripgrep', 'bin', binaryName)
    ];

    for (const candidate of extensionCandidates) {
      if (this.isValidExecutable(candidate)) {
        return candidate;
      }
    }

    // 4. フォールバック: システムの PATH 上の 'rg' (または 'rg.exe')
    return binaryName;
  }

  /**
   * 指定されたパスのファイルが存在し、実行可能かどうかを検証する
   * (Linux / macOS の場合は必要に応じて実行権限を付与)
   */
  private isValidExecutable(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return false;
      }

      // Windows 以外の場合、実行権限を確認し、無ければ付与を試みる
      if (process.platform !== 'win32') {
        try {
          fs.accessSync(filePath, fs.constants.X_OK);
        } catch {
          // 実行権限がない場合は付与を試みる
          try {
            fs.chmodSync(filePath, 0o755);
          } catch {
            // chmod 失敗時はそのまま
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * WebviewView が作成・表示された際に VS Code から呼ばれる
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    // Webview のオプション設定 (スクリプトの有効化・ローカルリソースのアクセス許可)
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    // HTML コンテンツの設定
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Webview からのメッセージ受信ハンドラ
    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      await this.handleWebviewMessage(message);
    });
  }

  /**
   * Webview から受信したメッセージを処理する
   */
  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.command) {
      case 'search':
        await this.handleSearchCommand(message.options);
        break;

      case 'cancel':
        this.runner.cancel();
        this.postMessageToWebview({ command: 'searchCancelled' });
        break;

      case 'openFile':
        await this.handleOpenFile(
          message.filePath,
          message.line,
          message.column,
          message.length,
          message.encoding
        );
        break;
    }
  }

  /**
   * 検索コマンドを処理する
   */
  private async handleSearchCommand(options: SearchOptions): Promise<void> {
    // ワークスペースフォルダの確認
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.postMessageToWebview({
        command: 'searchError',
        errorMessage: vscode.l10n.t('No workspace folder is open. Please open a folder before searching.'),
        errorType: 'other'
      });
      return;
    }

    const folderPaths = workspaceFolders.map((f) => f.uri.fsPath);

    // 使用する ripgrep のパスを解決
    const rgPath = this.resolveRipgrepPath();

    // 検索対象エンコーディングを設定から取得
    const config = vscode.workspace.getConfiguration('multiEncodingSearch');
    const configuredEncodings = config.get<SupportedEncoding[]>('encodings', ['utf-8', 'euc-jp', 'shift_jis']);
    options.targetEncodings = configuredEncodings.length > 0 ? configuredEncodings : ['utf-8', 'euc-jp', 'shift_jis'];

    // 検索開始を通知
    this.postMessageToWebview({ command: 'searchStart' });

    // ripgrep の実行 (複数文字コード同時並行)
    this.runner.search(
      rgPath,
      folderPaths,
      options,
      // 進捗コールバック
      (results, totalMatches, totalFiles, isTruncated) => {
        this.postMessageToWebview({
          command: 'searchProgress',
          results,
          totalMatches,
          totalFiles,
          isTruncated
        });
      },
      // 完了コールバック
      (totalMatches, totalFiles, isTruncated) => {
        this.postMessageToWebview({
          command: 'searchComplete',
          totalMatches,
          totalFiles,
          isTruncated
        });
      },
      // エラーコールバック
      (errorMessage, errorType) => {
        let localizedMessage = errorMessage;
        if (errorType === 'rgNotFound') {
          localizedMessage = vscode.l10n.t("ripgrep (rg) was not found. Please install ripgrep or specify its path in settings 'multiEncodingSearch.rgPath'.");
        }
        this.postMessageToWebview({
          command: 'searchError',
          errorMessage: localizedMessage,
          errorType
        });
      }
    );
  }

  /**
   * 該当ファイルを開き、自動で検出されたエンコーディングを適用して該当行・列にジャンプする
   */
  private async handleOpenFile(
    filePath: string,
    line: number,
    column: number,
    length: number,
    encoding: SupportedEncoding
  ): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(fileUri);

      // VS Code の行番号・列番号は 0 始まり
      const startLine = Math.max(0, line - 1);
      const startCol = Math.max(0, column - 1);
      const endCol = startCol + Math.max(1, length);

      const selectionRange = new vscode.Range(
        new vscode.Position(startLine, startCol),
        new vscode.Position(startLine, endCol)
      );

      // エディタで開く
      const editor = await vscode.window.showTextDocument(doc, {
        selection: selectionRange,
        preview: true,
        viewColumn: vscode.ViewColumn.One
      });

      // VS Code のエンコーディング名へ変換
      const vscodeEncodingMap: Record<SupportedEncoding, string> = {
        'utf-8': 'utf8',
        'euc-jp': 'eucjp',
        'shift_jis': 'shiftjis',
        'utf-16le': 'utf16le',
        'utf-16be': 'utf16be',
        'windows-1252': 'windows1252',
        'gb18030': 'gb18030',
        'gbk': 'gbk',
        'big5': 'big5',
        'euc-kr': 'euckr'
      };
      const targetEncoding = vscodeEncodingMap[encoding] || 'utf8';

      // 該当の文字コードでエディタを再読み込み (Reopen with Encoding)
      try {
        await vscode.commands.executeCommand('workbench.action.editor.reopenWithEncoding', targetEncoding);
      } catch {
        // コマンドがサポートされていない環境ではフォールバック
      }

      // 再読み込み後に再度カーソル位置・選択範囲を調整
      if (editor && editor.document) {
        editor.selection = new vscode.Selection(
          new vscode.Position(startLine, startCol),
          new vscode.Position(startLine, endCol)
        );
        editor.revealRange(selectionRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    } catch (error: any) {
      const errMsg = vscode.l10n.t('Failed to open file: {0} ({1})', filePath, error?.message || error);
      vscode.window.showErrorMessage(errMsg);
    }
  }

  /**
   * Webview へメッセージを送信するヘルパー
   */
  private postMessageToWebview(message: ExtensionMessage): void {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  /**
   * 現在のロケールに応じたUI文字列辞書を取得する
   */
  private getI18nStrings() {
    const isJapanese = vscode.env.language.startsWith('ja');

    const translate = (enKey: string, jaDefault: string): string => {
      // vscode.l10n.t の結果を取得
      const translated = vscode.l10n.t(enKey);
      // もし l10n.t がキーと同じ（未翻訳）で、日本語環境なら jaDefault を使用
      if (translated === enKey && isJapanese) {
        return jaDefault;
      }
      return translated;
    };

    return {
      searchPlaceholder: translate('Search (EUC-JP / UTF-8 / SJIS Auto)', '検索 (EUC-JP / UTF-8 / SJIS 自動)'),
      matchCase: translate('Match Case', '大文字/小文字を区別 (Match Case)'),
      matchWholeWord: translate('Match Whole Word', '単語全体に一致 (Match Whole Word)'),
      useRegularExpression: translate('Use Regular Expression', '正規表現を使用 (Use Regular Expression)'),
      searchBtn: translate('Search', '検索'),
      stopBtn: translate('Stop', '停止'),
      autoEncodingBadge: translate('⚡ Auto Encoding', '⚡ 文字コード自動判定'),
      autoEncodingBadgeTitle: translate(
        'Searches EUC-JP, UTF-8, and Shift_JIS automatically in parallel',
        'EUC-JP、UTF-8、Shift_JIS を同時に自動並行検索します'
      ),
      detailsToggle: translate('Details', '詳細条件'),
      detailsToggleTitle: translate('Toggle search details', '詳細検索オプションの表示切り替え'),
      filesToInclude: translate('files to include', '含めるファイル'),
      filesToIncludePlaceholder: translate('e.g. *.php, src/**', '例: *.php, src/**'),
      filesToExclude: translate('files to exclude', '除外するファイル'),
      filesToExcludePlaceholder: translate('e.g. node_modules/**, vendor/**', '例: node_modules/**, vendor/**'),
      searching: translate('Searching...', '検索中...'),
      noResults: translate('No results found.', '一致する結果は見つかりませんでした。'),
      resultsTruncated: translate(' (showing first 10,000 results)', ' (上限10,000件に達したため一部のみ表示)'),
      searchCancelled: translate('Search was cancelled.', '検索がキャンセルされました。')
    };
  }

  /**
   * Webview の HTML を生成する
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css')
    );

    const nonce = this.getNonce();

    // l10n 文字列の取得
    const i18n = this.getI18nStrings();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>EUC-JP Search</title>
</head>
<body>
  <div class="search-container">
    <!-- 検索入力行 -->
    <div class="search-input-wrapper">
      <div class="input-box-container">
        <input type="text" id="searchInput" class="search-input" placeholder="${i18n.searchPlaceholder}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        <div class="input-actions">
          <button id="btnCaseSensitive" class="icon-toggle-btn" title="${i18n.matchCase}">
            <span class="toggle-icon">Aa</span>
          </button>
          <button id="btnWordMatch" class="icon-toggle-btn" title="${i18n.matchWholeWord}">
            <span class="toggle-icon">\\b</span>
          </button>
          <button id="btnRegex" class="icon-toggle-btn" title="${i18n.useRegularExpression}">
            <span class="toggle-icon">.*</span>
          </button>
        </div>
      </div>
      <button id="btnSearch" class="primary-btn" title="${i18n.searchBtn} (Enter)">${i18n.searchBtn}</button>
    </div>

    <!-- オプション行 (自動判定バッジ & 詳細トグル) -->
    <div class="search-options-row">
      <span class="auto-encoding-badge" title="${i18n.autoEncodingBadgeTitle}">${i18n.autoEncodingBadge}</span>
      <button id="btnToggleDetails" class="details-toggle-btn" title="${i18n.detailsToggleTitle}">
        <span id="detailsToggleIcon" class="codicon-arrow">▸</span> ${i18n.detailsToggle}
      </button>
    </div>

    <!-- 詳細条件 (include / exclude) -->
    <div id="detailsContainer" class="details-container hidden">
      <div class="details-field">
        <label for="includeInput" class="field-label">${i18n.filesToInclude}:</label>
        <input type="text" id="includeInput" class="details-input" placeholder="${i18n.filesToIncludePlaceholder}" />
      </div>
      <div class="details-field">
        <label for="excludeInput" class="field-label">${i18n.filesToExclude}:</label>
        <input type="text" id="excludeInput" class="details-input" placeholder="${i18n.filesToExcludePlaceholder}" />
      </div>
    </div>

    <!-- 検索状況・メッセージ表示領域 -->
    <div id="statusContainer" class="status-container"></div>

    <!-- 検索結果一覧表示領域 -->
    <div id="resultsContainer" class="results-container"></div>
  </div>

  <script nonce="${nonce}">
    window.i18nStrings = ${JSON.stringify(i18n)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * CSP用のランダム文字列を生成
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
