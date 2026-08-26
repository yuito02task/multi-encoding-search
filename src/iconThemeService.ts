import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * ファイルアイコンテーマ定義内の iconDefinition 情報
 */
interface IconDefinition {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
}

/**
 * VS Code ファイルアイコンテーマ JSON の構造
 */
interface IconThemeData {
  iconDefinitions?: Record<string, IconDefinition>;
  file?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
}

/**
 * VS Code のファイルアイコンテーマを解決し、Webview 向けにアイコン Data URI を提供するサービス
 */
export class FileIconService {
  private currentThemeId: string | null = null;
  private activeThemeExtensionUri?: vscode.Uri;
  private iconThemeData?: IconThemeData;
  private themeDirectory?: string;
  private iconCache = new Map<string, string>();

  constructor() {
    this.refreshTheme();
  }

  /**
   * Webview の localResourceRoots に登録すべきアクティブテーマ拡張機能の URI を取得
   */
  public getThemeExtensionUri(): vscode.Uri | undefined {
    return this.activeThemeExtensionUri;
  }

  /**
   * 現在の VS Code のアクティブなアイコンテーマ設定を読み込み、テーマ定義を初期化する
   */
  public refreshTheme(): void {
    try {
      this.iconCache.clear();
      const config = vscode.workspace.getConfiguration('workbench');
      const iconTheme = config.get<string | null>('iconTheme');

      this.currentThemeId = iconTheme || 'vs-seti';

      if (!iconTheme || iconTheme === 'none' || iconTheme === 'vs-minimal') {
        this.activeThemeExtensionUri = undefined;
        this.iconThemeData = undefined;
        this.themeDirectory = undefined;
        return;
      }

      // 1. vscode.extensions.all からテーマ定義を探索
      const loaded = this.loadThemeFromExtensionApi(this.currentThemeId);
      if (loaded) {
        return;
      }

      // 2. ディスク上の拡張機能ディレクトリ (~/.vscode/extensions 等) を直接探索
      this.loadThemeFromDisk(this.currentThemeId);
    } catch (error) {
      console.warn('アイコンテーマの読み込みに失敗しました:', error);
      this.iconThemeData = undefined;
      this.themeDirectory = undefined;
    }
  }

  /**
   * vscode.extensions API を使用してテーマ定義をロード
   */
  private loadThemeFromExtensionApi(themeId: string): boolean {
    for (const extension of vscode.extensions.all) {
      const packageJSON = extension.packageJSON;
      const contributes = packageJSON?.contributes;
      const iconThemes = contributes?.iconThemes;

      if (Array.isArray(iconThemes)) {
        const matchedTheme = iconThemes.find(
          (t: any) => t.id === themeId || t.label === themeId
        );

        if (matchedTheme && matchedTheme.path) {
          const themeJsonPath = path.join(extension.extensionPath, matchedTheme.path);
          if (this.tryLoadThemeJson(themeJsonPath)) {
            this.activeThemeExtensionUri = extension.extensionUri;
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * ディスク上の拡張機能フォルダからテーマ定義を直接探索
   */
  private loadThemeFromDisk(themeId: string): boolean {
    const homeDir = os.homedir();
    const candidateDirs = [
      path.join(homeDir, '.vscode', 'extensions'),
      path.join(homeDir, '.vscode-server', 'extensions'),
      path.join(homeDir, '.vscode-insiders', 'extensions'),
      path.join(homeDir, '.antigravity', 'extensions'),
      path.join(homeDir, '.cursor', 'extensions')
    ];

    const cleanThemeId = themeId.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const extensionsDir of candidateDirs) {
      if (!fs.existsSync(extensionsDir)) continue;

      try {
        const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryName = entry.name.toLowerCase();

          // テーマ ID と合致しそうな拡張機能ディレクトリをチェック (例: pkief.material-icon-theme-*)
          if (entryName.includes(themeId.toLowerCase()) || (cleanThemeId && entryName.replace(/[^a-z0-9]/g, '').includes(cleanThemeId))) {
            const extDirPath = path.join(extensionsDir, entry.name);
            const pkgPath = path.join(extDirPath, 'package.json');
            if (fs.existsSync(pkgPath)) {
              try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const iconThemes = pkg.contributes?.iconThemes;
                if (Array.isArray(iconThemes)) {
                  const matchedTheme = iconThemes.find(
                    (t: any) => t.id === themeId || t.label === themeId || iconThemes.length === 1
                  );
                  if (matchedTheme && matchedTheme.path) {
                    const themeJsonPath = path.join(extDirPath, matchedTheme.path);
                    if (this.tryLoadThemeJson(themeJsonPath)) {
                      return true;
                    }
                  }
                }
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return false;
  }

  /**
   * テーマ JSON ファイルを読み込んで初期化
   */
  private tryLoadThemeJson(themeJsonPath: string): boolean {
    try {
      if (!fs.existsSync(themeJsonPath)) return false;
      const content = fs.readFileSync(themeJsonPath, 'utf8');
      this.iconThemeData = this.parseJsonc(content);
      this.themeDirectory = path.dirname(themeJsonPath);
      return true;
    } catch (err) {
      console.warn(`テーマ定義 JSON (${themeJsonPath}) の読み込みに失敗:`, err);
      return false;
    }
  }

  /**
   * JSONC (コメントや末尾カンマを含む JSON) を安全にパース
   */
  private parseJsonc(content: string): any {
    try {
      const cleaned = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch {
      return JSON.parse(content);
    }
  }

  /**
   * 指定されたファイル名に対応するアイコン Data URI を取得する
   * @param fileName ファイル名 (例: "index.ts", "package.json")
   */
  public getFileIconUri(fileName: string): string {
    const cacheKey = fileName.toLowerCase();
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!;
    }

    let resolvedUri = '';

    // 1. アクティブなアイコンテーマ (Material Icon Theme 等) からの解決
    if (this.iconThemeData && this.themeDirectory) {
      resolvedUri = this.resolveIconFromTheme(fileName);
    }

    // 2. テーマから取得できなかった場合は VS Code 標準 / Seti 公式デザインの SVG アイコンを使用
    if (!resolvedUri) {
      resolvedUri = this.getVsCodeOfficialSvgIcon(fileName);
    }

    this.iconCache.set(cacheKey, resolvedUri);
    return resolvedUri;
  }

  /**
   * テーマ定義 JSON からファイルアイコンの Data URI を解決
   */
  private resolveIconFromTheme(fileName: string): string {
    if (!this.iconThemeData || !this.themeDirectory || !this.iconThemeData.iconDefinitions) {
      return '';
    }

    const lowerName = fileName.toLowerCase();
    const parts = lowerName.split('.');
    const ext = parts.length > 1 ? parts.slice(1).join('.') : '';
    const simpleExt = parts.length > 1 ? parts[parts.length - 1] : '';

    const defs = this.iconThemeData.iconDefinitions;
    let iconKey: string | undefined;

    // ① 完全一致ファイル名 (例: package.json, dockerfile, .gitignore)
    if (this.iconThemeData.fileNames && this.iconThemeData.fileNames[lowerName]) {
      iconKey = this.iconThemeData.fileNames[lowerName];
    }
    // ② 複合拡張子 (例: test.spec.ts -> spec.ts)
    else if (ext && this.iconThemeData.fileExtensions && this.iconThemeData.fileExtensions[ext]) {
      iconKey = this.iconThemeData.fileExtensions[ext];
    }
    // ③ 単純拡張子 (例: ts, php, js, html, css)
    else if (simpleExt && this.iconThemeData.fileExtensions && this.iconThemeData.fileExtensions[simpleExt]) {
      iconKey = this.iconThemeData.fileExtensions[simpleExt];
    }
    // ④ 言語 ID
    else if (this.iconThemeData.languageIds && this.iconThemeData.languageIds[simpleExt]) {
      iconKey = this.iconThemeData.languageIds[simpleExt];
    }
    // ⑤ デフォルトファイルアイコン
    else if (this.iconThemeData.file) {
      iconKey = this.iconThemeData.file;
    }

    if (iconKey && defs[iconKey] && defs[iconKey].iconPath) {
      const relIconPath = defs[iconKey].iconPath!;
      const absIconPath = path.resolve(this.themeDirectory, relIconPath);
      if (fs.existsSync(absIconPath)) {
        try {
          const fileExt = path.extname(absIconPath).toLowerCase();
          if (fileExt === '.svg') {
            const svgContent = fs.readFileSync(absIconPath, 'utf8');
            return `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
          } else {
            const buffer = fs.readFileSync(absIconPath);
            const mimeType = fileExt === '.png' ? 'image/png' : 'image/svg+xml';
            return `data:${mimeType};base64,${buffer.toString('base64')}`;
          }
        } catch {
          // ignore
        }
      }
    }

    return '';
  }

  /**
   * VS Code 標準 / Seti 公式デザインに準拠した高品質 SVG アイコン (Data URI) を返す
   */
  private getVsCodeOfficialSvgIcon(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const baseName = fileName.toLowerCase();

    // package.json / npm
    if (baseName === 'package.json') {
      return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
        <path fill="#cb3837" d="M2 4v24h28V4H2zm22.5 19.5h-4.5v-11h-4v11H6.5V8.5h18v15z"/>
      </svg>`);
    }

    // .gitignore / git
    if (baseName === '.gitignore' || baseName.endsWith('.git')) {
      return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
        <path fill="#F05032" d="M30.6 13.8L18.2 1.4c-1.8-1.8-4.8-1.8-6.6 0L9.2 3.8l3.7 3.7c1.3-.4 2.8-.1 3.8.9 1 1 1.3 2.5.9 3.8l3.6 3.6c1.3-.4 2.8-.1 3.8.9 1.4 1.4 1.4 3.7 0 5.1s-3.7 1.4-5.1 0c-1.1-1.1-1.3-2.7-.6-4.1l-3.3-3.3v8.7c.6.3 1.1.8 1.4 1.4 1 1.8.3 4-1.5 5-1.8 1-4 .3-5-1.5-1-1.8-.3-4 1.5-5 .6-.3 1.2-.5 1.8-.5V9.4c-.6 0-1.2-.2-1.8-.5C6.1 7.5 6.8 5.3 8.6 4.3c.7-.4 1.5-.5 2.2-.4L7.1 1.7C5.3 3.5 1.4 7.4 1.4 7.4c-1.8 1.8-1.8 4.8 0 6.6l12.4 12.4c1.8 1.8 4.8 1.8 6.6 0l10.2-10.2c1.8-1.8 1.8-4.8 0-6.6z"/>
      </svg>`);
    }

    switch (ext) {
      // TypeScript
      case '.ts':
      case '.tsx':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <rect width="32" height="32" rx="3" fill="#3178c6"/>
          <path fill="#ffffff" d="M13.6 12.5H6.4V9.6h17.2v2.9h-7.2V25h-2.8V12.5z"/>
          <path fill="#ffffff" d="M22.5 19.3c1.3.8 2.5 1.4 3.7 1.4 1.4 0 2.2-.7 2.2-1.7 0-1.1-.9-1.6-2.6-2.3-2.6-1-4.2-2.3-4.2-4.7 0-2.8 2.2-4.8 5.6-4.8 1.8 0 3.3.5 4.4 1.2l-1 2.4c-.9-.6-2.1-1-3.4-1-1.5 0-2.3.8-2.3 1.7 0 1 .8 1.5 2.4 2.1 2.8 1.1 4.5 2.3 4.5 4.9 0 3-2.3 5-6 5-2 0-3.8-.6-5.1-1.5l1.2-2.5z"/>
        </svg>`);

      // JavaScript
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <rect width="32" height="32" rx="3" fill="#f7df1e"/>
          <path fill="#000000" d="M12.5 21.7c0 2.2-1.4 3.1-3.5 3.1-2.1 0-3.3-.9-4.1-2l1.9-1.5c.5.7 1.1 1.2 2 1.2.9 0 1.4-.4 1.4-1.3v-8.4h2.3v8.9zm8.2-1.5c1.3.8 2.5 1.4 3.7 1.4 1.4 0 2.2-.7 2.2-1.7 0-1.1-.9-1.6-2.6-2.3-2.6-1-4.2-2.3-4.2-4.7 0-2.8 2.2-4.8 5.6-4.8 1.8 0 3.3.5 4.4 1.2l-1 2.4c-.9-.6-2.1-1-3.4-1-1.5 0-2.3.8-2.3 1.7 0 1 .8 1.5 2.4 2.1 2.8 1.1 4.5 2.3 4.5 4.9 0 3-2.3 5-6 5-2 0-3.8-.6-5.1-1.5l1.2-2.5z"/>
        </svg>`);

      // PHP
      case '.php':
      case '.phtml':
      case '.php4':
      case '.php5':
      case '.php7':
      case '.inc':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <ellipse cx="16" cy="16" rx="15" ry="10" fill="#777BB4"/>
          <path fill="#ffffff" d="M10.8 11.2c-.8 0-1.4.2-1.7.5-.4.3-.5.8-.5 1.4l-.8 4.7H6.2l1.6-9.6h3.4l-.3 1.8c.6-.7 1.2-1.2 1.8-1.5.6-.3 1.3-.4 2-.4 1.4 0 2.4.4 3.1 1.2.7.8 1 2 1 3.5 0 1.8-.4 3.3-1.3 4.4-.9 1.1-2.2 1.7-3.9 1.7h-2.1l.8-4.7c.3-.8.6-1.5.9-1.9.3-.5.8-.7 1.4-.7.6 0 1.1.2 1.4.6.3.4.5 1 .5 1.8 0 1.2-.2 2.2-.6 2.8-.4.7-1 1-1.8 1-.4 0-.8-.1-1.1-.3l.7-4.1c0-.4-.1-.8-.3-1.1-.3-.3-.8-.4-1.4-.4z"/>
        </svg>`);

      // HTML
      case '.html':
      case '.htm':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#e34f26" d="M5.5 28.5L3 1h26l-2.5 27.5L16 32z"/>
          <path fill="#ef652a" d="M16 29.8l8.3-2.3L26 3H16v26.8z"/>
          <path fill="#ffffff" d="M16 14.5h4.6l-.3 3.6-4.3 1.2v3.3l7.6-2.1.8-9.4H16v3.4zm0-6.8h8.2l.3-3.3H8l.9 10.1H16V7.7z"/>
          <path fill="#ebebeb" d="M16 14.5H8.6l.3 3.4h7.1v-3.4zm0 8.1v-3.3l-4.3-1.2-.3-3.4H8.6l.5 6.8 6.9 1.1z"/>
        </svg>`);

      // CSS
      case '.css':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#1572b6" d="M5.5 28.5L3 1h26l-2.5 27.5L16 32z"/>
          <path fill="#33a9dc" d="M16 29.8l8.3-2.3L26 3H16v26.8z"/>
          <path fill="#ffffff" d="M16 14.5h4.6l-.3 3.6-4.3 1.2v3.3l7.6-2.1.8-9.4H16v3.4zm0-6.8h8.2l.3-3.3H8l.9 10.1H16V7.7z"/>
          <path fill="#ebebeb" d="M16 14.5H8.6l.3 3.4h7.1v-3.4zm0 8.1v-3.3l-4.3-1.2-.3-3.4H8.6l.5 6.8 6.9 1.1z"/>
        </svg>`);

      // JSON
      case '.json':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#fbc02d" d="M13 6c-1.7 0-3 1.3-3 3v4c0 1.1-.9 2-2 2 1.1 0 2 .9 2 2v4c0 1.7 1.3 3 3 3h1v-3h-1c-.6 0-1-.4-1-1v-4c0-1.1-.9-2-2-2 1.1 0 2-.9 2-2V9c0-.6.4-1 1-1h1V6h-1zm6 0h-1v3h1c.6 0 1 .4 1 1v4c0 1.1.9 2 2 2-1.1 0-2 .9-2 2v4c0 .6-.4 1-1 1h-1v3h1c1.7 0 3-1.3 3-3v-4c0-1.1.9-2 2-2-1.1 0-2-.9-2-2V9c0-1.7-1.3-3-3-3z"/>
        </svg>`);

      // Markdown
      case '.md':
      case '.markdown':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <rect width="32" height="24" y="4" rx="2" fill="#ffffff" stroke="#444444" stroke-width="2"/>
          <path fill="#444444" d="M6 9v14h3v-7l3 4 3-4v7h3V9h-3l-3 4-3-4H6zm16 0v7h-3l4.5 6 4.5-6h-3V9h-3z"/>
        </svg>`);

      // Python
      case '.py':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#3776ab" d="M15.9 2c-7.3 0-6.8 3.2-6.8 3.2l.01 3.3h6.9v1H5.4s-3.4.4-3.4 6.8c0 6.4 3 6.2 3 6.2h1.8v-2.5s-.1-3 3-3h5.1s2.9-.1 2.9-2.9V4.9s.5-2.9-2.9-2.9zm-3.8 2.2c.6 0 1.1.5 1.1 1.1 0 .6-.5 1.1-1.1 1.1-.6 0-1.1-.5-1.1-1.1 0-.6.5-1.1 1.1-1.1z"/>
          <path fill="#ffd43b" d="M16.1 30c7.3 0 6.8-3.2 6.8-3.2l-.01-3.3h-6.9v-1h10.6s3.4-.4 3.4-6.8c0-6.4-3-6.2-3-6.2h-1.8v2.5s.1 3-3 3h-5.1s-2.9.1-2.9 2.9v9.2s-.5 2.9 2.9 2.9zm3.8-2.2c-.6 0-1.1-.5-1.1-1.1 0-.6.5-1.1 1.1-1.1.6 0 1.1.5 1.1 1.1 0 .6-.5 1.1-1.1 1.1z"/>
        </svg>`);

      // C / C++
      case '.c':
      case '.cpp':
      case '.cc':
      case '.cxx':
      case '.h':
      case '.hpp':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#00599c" d="M16 2L3 9.5v15L16 32l13-7.5v-15L16 2zm0 4.1l9.5 5.5v11L16 28l-9.5-5.4v-11L16 6.1z"/>
          <path fill="#00599c" d="M20.5 12.3c-.9-.5-1.9-.8-3-.8-3.1 0-5.4 2-5.4 5.3s2.3 5.3 5.4 5.3c1.1 0 2.1-.3 3-.8l.9 2.1c-1.1.7-2.5 1-3.9 1-4.7 0-8.2-3.2-8.2-7.6s3.5-7.6 8.2-7.6c1.4 0 2.8.3 3.9 1l-.9 2.1z"/>
        </svg>`);

      // Java
      case '.java':
      case '.class':
      case '.jar':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#e76f00" d="M11.5 24.5c0 0-1.5.8 1.1 1.1 3.2.4 4.8.3 8.3-.4 0 0 1.2.8 2.5 1.5-6.7 3.3-16.1 1.2-11.9-2.2m-.4-4.7c0 0-1.7 1.2.9 1.4 3.4.3 6.1.4 10.7-.7 0 0 .9.9 1.8 1.4-5.3 2.7-16.8 2-13.4-2.1"/>
          <path fill="#5382a1" d="M18.8 13.7c1.4 1.6.8 3-1.1 4.5-1.9 1.5-3.6 2.3-3.6 2.3s1.2-.8 2.5-1.7c1.3-.9 1.8-1.8 1.2-2.7-1.1-1.3-3.2-1.9-4.7-4 2.2.4 4.3.1 5.7 1.6"/>
        </svg>`);

      // Shell
      case '.sh':
      case '.bash':
      case '.zsh':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <rect width="32" height="26" y="3" rx="2" fill="#2d3748"/>
          <path fill="#48bb78" d="M8 10l5 5-5 5M15 20h8" stroke="#48bb78" stroke-width="2" stroke-linecap="round"/>
        </svg>`);

      // SQL
      case '.sql':
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <ellipse cx="16" cy="7" rx="12" ry="5" fill="#e38c00"/>
          <path fill="#e38c00" d="M4 7v6c0 2.8 5.4 5 12 5s12-2.2 12-5V7M4 13v6c0 2.8 5.4 5 12 5s12-2.2 12-5v-6M4 19v6c0 2.8 5.4 5 12 5s12-2.2 12-5v-6"/>
        </svg>`);

      // VS Code 標準ファイル (汎用ドキュメント)
      default:
        return this.svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">
          <path fill="#90a4ae" d="M6 3a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V11l-8-8H6zm13 1.5L25.5 11H19V4.5zM6 5h11v8h8v14H6V5z"/>
        </svg>`);
    }
  }

  /**
   * SVG 文字列を Data URI に変換
   */
  private svgDataUri(svg: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }
}
