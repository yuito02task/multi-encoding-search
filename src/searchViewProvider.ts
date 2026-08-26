import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { RipgrepRunner } from './ripgrepRunner';
import { FileIconService } from './iconThemeService';
import { SearchOptions, WebviewMessage, ExtensionMessage, SupportedEncoding, ResultDisplaySettings } from './types';

/**
 * マルチ文字コード検索のサイドバー WebviewView プロバイダー
 */
export class EucjpSearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'multiEncodingSearch.searchView';

  private view?: vscode.WebviewView;
  private readonly runner: RipgrepRunner;
  private readonly iconService: FileIconService;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.runner = new RipgrepRunner();
    this.iconService = new FileIconService();

    // 設定変更の監視 (フォントサイズや色の変更、アイコンテーマの変更を即座に Webview へ通知)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('multiEncodingSearch.results')) {
        this.postMessageToWebview({
          command: 'updateSettings',
          settings: this.getDisplaySettings()
        });
      }
      if (e.affectsConfiguration('workbench.iconTheme')) {
        this.iconService.refreshTheme();
        this.updateWebviewOptions();
        this.postMessageToWebview({
          command: 'updateSettings',
          settings: this.getDisplaySettings()
        });
      }
    });
  }

  /**
   * 現在の表示カスタマイズ設定を取得する
   */
  private getDisplaySettings(): ResultDisplaySettings {
    const config = vscode.workspace.getConfiguration('multiEncodingSearch.results');
    return {
      showLineNumbers: config.get<boolean>('showLineNumbers', false),
      fontSize: config.get<number>('fontSize', 0),
      fontFamily: config.get<string>('fontFamily', ''),
      matchHighlightBackground: config.get<string>('matchHighlightBackground', ''),
      matchHighlightForeground: config.get<string>('matchHighlightForeground', ''),
      textColor: config.get<string>('textColor', ''),
      secondaryTextColor: config.get<string>('secondaryTextColor', '')
    };
  }

  /**
   * 使用する ripgrep (rg) の実行ファイルパスを解決する (Windows / WSL / Linux / macOS 対応)
   */
  private resolveRipgrepPath(): string {
    const config = vscode.workspace.getConfiguration('multiEncodingSearch');
    const userConfigPath = config.get<string>('rgPath', 'rg');

    // 1. ユーザーが明示的にデフォルト ('rg') 以外のカスタムパスを指定している場合は最優先
    if (userConfigPath && userConfigPath !== 'rg' && userConfigPath.trim().length > 0) {
      if (this.isValidExecutable(userConfigPath)) {
        return userConfigPath;
      }
    }

    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'rg.exe' : 'rg';
    const platformArch = `${process.platform}-${process.arch}`;

    // 2. VS Code 本体同梱 ripgrep の探索 (デスクトップ / WSL / Remote SSH / Containers すべて対応)
    const appRoot = vscode.env.appRoot;
    if (appRoot) {
      const vscodeCandidates = [
        // @vscode/ripgrep-universal (VS Code 1.122+ 新構造)
        path.join(appRoot, 'node_modules', '@vscode', 'ripgrep-universal', 'bin', platformArch, binaryName),
        path.join(appRoot, 'node_modules', '@vscode', 'ripgrep-universal', 'bin', binaryName),
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', platformArch, binaryName),
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', binaryName),
        // @vscode/ripgrep (従来構造)
        path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules', '@vscode', `ripgrep-${platformArch}`, 'bin', binaryName),
        // vscode-ripgrep
        path.join(appRoot, 'node_modules', 'vscode-ripgrep', 'bin', binaryName),
        path.join(appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', binaryName),
        // 親ディレクトリ階層 (VS Code Server 等)
        path.join(appRoot, '..', 'node_modules', '@vscode', 'ripgrep-universal', 'bin', platformArch, binaryName),
        path.join(appRoot, '..', 'node_modules', '@vscode', 'ripgrep-universal', 'bin', binaryName),
        path.join(appRoot, '..', 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
        path.join(appRoot, '..', 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', binaryName)
      ];

      for (const candidate of vscodeCandidates) {
        if (this.isValidExecutable(candidate)) {
          return candidate;
        }
      }

      // appRoot 配下の再帰探索フォールバック
      const foundInAppRoot = this.findRipgrepRecursively(appRoot, binaryName, 3);
      if (foundInAppRoot) {
        return foundInAppRoot;
      }
    }

    // 3. システム PATH および Linux / macOS 標準ディレクトリの探索
    if (!isWindows) {
      const standardUnixPaths = [
        '/usr/bin/rg',
        '/usr/local/bin/rg',
        '/snap/bin/rg',
        '/bin/rg',
        path.join(process.env.HOME || '', '.cargo', 'bin', 'rg'),
        path.join(process.env.HOME || '', '.local', 'bin', 'rg')
      ];

      for (const unixPath of standardUnixPaths) {
        if (this.isValidExecutable(unixPath)) {
          return unixPath;
        }
      }

      // which コマンドによる探索
      try {
        const whichOutput = childProcess.execSync('which rg', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (whichOutput && this.isValidExecutable(whichOutput)) {
          return whichOutput;
        }
      } catch {
        // ignore
      }
    } else {
      // Windows where コマンドによる探索
      try {
        const whereOutput = childProcess.execSync('where.exe rg', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim();
        if (whereOutput && this.isValidExecutable(whereOutput)) {
          return whereOutput;
        }
      } catch {
        // ignore
      }
    }

    // 4. 拡張機能自身のディレクトリ内のバイナリ探索 (現在のプラットフォームに合致するもののみ)
    const extFsPath = this.extensionUri.fsPath;
    const extensionCandidates = [
      path.join(extFsPath, 'node_modules', '@vscode', `ripgrep-${platformArch}`, 'bin', binaryName),
      path.join(extFsPath, 'node_modules', `@vscode/ripgrep-${platformArch}`, 'bin', binaryName),
      path.join(extFsPath, 'node_modules', '@vscode', 'ripgrep', 'bin', binaryName),
      path.join(extFsPath, 'node_modules', 'vscode-ripgrep', 'bin', binaryName)
    ];

    for (const candidate of extensionCandidates) {
      if (this.isValidExecutable(candidate)) {
        return candidate;
      }
    }

    // 5. 最終フォールバック: システムの PATH 上の 'rg'
    return binaryName;
  }

  /**
   * 指定ディレクトリ配下から ripgrep 実行ファイルを探索する (深さ制限付き)
   */
  private findRipgrepRecursively(dir: string, binaryName: string, maxDepth: number): string | null {
    if (maxDepth < 0) {
      return null;
    }

    try {
      if (!fs.existsSync(dir)) {
        return null;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === binaryName) {
          if (this.isValidExecutable(fullPath)) {
            return fullPath;
          }
        } else if (entry.isDirectory()) {
          // ripgrep や node_modules 関連フォルダを優先探索
          if (
            entry.name === 'node_modules' ||
            entry.name === '@vscode' ||
            entry.name.includes('ripgrep') ||
            entry.name === 'bin'
          ) {
            const result = this.findRipgrepRecursively(fullPath, binaryName, maxDepth - 1);
            if (result) {
              return result;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * 指定されたパスのファイルが存在し、実行可能かどうかを検証する
   * (Linux / macOS の場合は必要に応じて実行権限を付与)
   */
  private isValidExecutable(filePath: string): boolean {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
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
    this.updateWebviewOptions();

    // HTML コンテンツの設定
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Webview からのメッセージ受信ハンドラ
    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      await this.handleWebviewMessage(message);
    });
  }

  /**
   * Webview のアクセス許可パス (localResourceRoots) を更新する
   */
  private updateWebviewOptions(): void {
    if (!this.view) return;
    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots()
    };
  }

  /**
   * Webview がアクセス可能なローカルディレクトリ一覧を取得する
   */
  private getLocalResourceRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(this.extensionUri, 'media')
    ];

    // アクティブなアイコンテーマ拡張機能の URI もアクセス許可に追加
    const themeUri = this.iconService.getThemeExtensionUri();
    if (themeUri) {
      roots.push(themeUri);
    }

    return roots;
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
          message.encoding,
          message.matchText
        );
        break;

      case 'requestSettings':
        this.postMessageToWebview({
          command: 'updateSettings',
          settings: this.getDisplaySettings()
        });
        break;
    }
  }

  /**
   * 検索結果の各ファイルにアイコン URI を付与する
   */
  private attachIconUris(results: any[]): void {
    if (!this.view) return;
    for (const file of results) {
      file.iconUri = this.iconService.getFileIconUri(this.view.webview, file.fileName);
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

    // 検索対象エンコーディングを設定から取得 (個別オン/オフ設定に対応)
    options.targetEncodings = this.getConfiguredEncodings();

    // 検索開始を通知
    this.postMessageToWebview({ command: 'searchStart' });

    // ripgrep の実行 (複数文字コード同時並行)
    this.runner.search(
      rgPath,
      folderPaths,
      options,
      // 進捗コールバック
      (results, totalMatches, totalFiles, isTruncated) => {
        this.attachIconUris(results);
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
    encoding: SupportedEncoding,
    matchText?: string
  ): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(fileUri);

      // VS Code の行番号は 0 始まり
      const targetLine = Math.max(0, line - 1);

      // エディタで開く
      const editor = await vscode.window.showTextDocument(doc, {
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

      // 再読み込み後、アクティブなエディタのドキュメントから正確な位置を算出
      const activeEditor = vscode.window.activeTextEditor || editor;
      if (activeEditor && activeEditor.document) {
        const currentDoc = activeEditor.document;
        let startCol = Math.max(0, column - 1);
        let matchLength = Math.max(1, length);

        // 実際の行テキストから matchText の位置を照合して完全に一致させる
        if (targetLine < currentDoc.lineCount) {
          const lineText = currentDoc.lineAt(targetLine).text;
          if (matchText && matchText.length > 0) {
            matchLength = matchText.length;
            // 指定された column 付近から matchText を探す
            const exactIdx = lineText.indexOf(matchText, Math.max(0, startCol - 5));
            if (exactIdx !== -1) {
              startCol = exactIdx;
            } else {
              // 行頭から再検索
              const fallbackIdx = lineText.indexOf(matchText);
              if (fallbackIdx !== -1) {
                startCol = fallbackIdx;
              }
            }
          }
        }

        const endCol = startCol + matchLength;
        const selectionRange = new vscode.Range(
          new vscode.Position(targetLine, startCol),
          new vscode.Position(targetLine, endCol)
        );

        activeEditor.selection = new vscode.Selection(
          new vscode.Position(targetLine, startCol),
          new vscode.Position(targetLine, endCol)
        );
        activeEditor.revealRange(selectionRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    } catch (error: any) {
      const errMsg = vscode.l10n.t('Failed to open file: {0} ({1})', filePath, error?.message || error);
      vscode.window.showErrorMessage(errMsg);
    }
  }

  /**
   * 設定から有効になっている検索対象文字コード一覧を取得する
   */
  private getConfiguredEncodings(): SupportedEncoding[] {
    const config = vscode.workspace.getConfiguration('multiEncodingSearch');
    const encodingsConfig = config.get<Record<string, boolean>>('encodings') || {};

    const encodings: SupportedEncoding[] = [];

    // 各エンコーディングのオン/オフ判定 (設定未定義の場合はすべてデフォルト true)
    if (encodingsConfig.utf8 !== false) encodings.push('utf-8');
    if (encodingsConfig.eucjp !== false) encodings.push('euc-jp');
    if (encodingsConfig.shiftjis !== false) encodings.push('shift_jis');
    if (encodingsConfig.utf16le !== false) encodings.push('utf-16le');
    if (encodingsConfig.utf16be !== false) encodings.push('utf-16be');
    if (encodingsConfig.windows1252 !== false) encodings.push('windows-1252');
    if (encodingsConfig.gb18030 !== false) encodings.push('gb18030');
    if (encodingsConfig.gbk !== false) encodings.push('gbk');
    if (encodingsConfig.big5 !== false) encodings.push('big5');
    if (encodingsConfig.euckr !== false) encodings.push('euc-kr');

    // 万が一すべてオフの場合は最低限 utf-8 を対象にする
    if (encodings.length === 0) {
      encodings.push('utf-8');
    }

    return encodings;
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
  <title>Multi-Encoding Search</title>
</head>
<body>
  <div class="search-container">
    <!-- 固定上部ヘッダー領域 (検索入力・オプション・詳細・ステータス) -->
    <div class="search-header">
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
    </div>

    <!-- 検索結果一覧表示領域 (スクロール可能領域) -->
    <div id="resultsContainer" class="results-container"></div>
  </div>

  <script nonce="${nonce}">
    window.i18nStrings = ${JSON.stringify(i18n)};
    window.initialSettings = ${JSON.stringify(this.getDisplaySettings())};
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
