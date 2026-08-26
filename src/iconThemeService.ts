import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
  light?: {
    file?: string;
    fileExtensions?: Record<string, string>;
    fileNames?: Record<string, string>;
  };
  dark?: {
    file?: string;
    fileExtensions?: Record<string, string>;
    fileNames?: Record<string, string>;
  };
}

/**
 * VS Code のファイルアイコンテーマを解決し、Webview 向けにアイコン URI を提供するサービス
 */
export class FileIconService {
  private activeThemeExtensionUri?: vscode.Uri;
  private iconThemeData?: IconThemeData;
  private themeDirectory?: string;
  private iconCache = new Map<string, string>();

  constructor() {
    this.refreshTheme();
  }

  /**
   * 現在の VS Code のアクティブなアイコンテーマ設定を読み込み、テーマ定義を初期化する
   */
  public refreshTheme(): void {
    try {
      this.iconCache.clear();
      const config = vscode.workspace.getConfiguration('workbench');
      const iconTheme = config.get<string | null>('iconTheme');

      if (!iconTheme || iconTheme === 'none' || iconTheme === 'vs-minimal') {
        this.activeThemeExtensionUri = undefined;
        this.iconThemeData = undefined;
        this.themeDirectory = undefined;
        return;
      }

      this.loadIconThemeFromExtensions(iconTheme);
    } catch (error) {
      console.warn('アイコンテーマの読み込みに失敗しました:', error);
      this.iconThemeData = undefined;
    }
  }

  /**
   * インストール済み拡張機能一覧から該当するアイコンテーマを探索して定義 JSON を読み込む
   * @param themeId 探索するテーマ ID またはラベル
   */
  private loadIconThemeFromExtensions(themeId: string): void {
    for (const extension of vscode.extensions.all) {
      const packageJSON = extension.packageJSON;
      const contributes = packageJSON?.contributes;
      const iconThemes = contributes?.iconThemes;

      if (Array.isArray(iconThemes)) {
        // ID または label でテーマを照合
        const matchedTheme = iconThemes.find(
          (t: any) => t.id === themeId || t.label === themeId
        );

        if (matchedTheme && matchedTheme.path) {
          const themeJsonAbsolutePath = path.join(extension.extensionPath, matchedTheme.path);
          if (fs.existsSync(themeJsonAbsolutePath)) {
            try {
              const fileContent = fs.readFileSync(themeJsonAbsolutePath, 'utf8');
              // JSONC (コメント付き JSON) を安全にパース
              this.iconThemeData = this.parseJsonc(fileContent);
              this.themeDirectory = path.dirname(themeJsonAbsolutePath);
              this.activeThemeExtensionUri = extension.extensionUri;
              return;
            } catch (err) {
              console.warn(`テーマ定義 JSON (${themeJsonAbsolutePath}) のパースに失敗しました:`, err);
            }
          }
        }
      }
    }

    // 拡張機能から見つからなかった場合
    this.activeThemeExtensionUri = undefined;
    this.iconThemeData = undefined;
    this.themeDirectory = undefined;
  }

  /**
   * JSONC (コメントや末尾カンマを含む JSON) を安全にパースする
   */
  private parseJsonc(content: string): any {
    try {
      // 1行コメント (//...) と複数行コメント (/*...*/) を除去
      const cleaned = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        // オブジェクト/配列の末尾カンマを除去
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch {
      // パース失敗時は標準 JSON.parse を試行
      return JSON.parse(content);
    }
  }

  /**
   * Webview の localResourceRoots に登録すべきアクティブテーマ拡張機能の URI を取得
   */
  public getThemeExtensionUri(): vscode.Uri | undefined {
    return this.activeThemeExtensionUri;
  }

  /**
   * 指定されたファイル名に対応するアイコン URI (Data URI) を取得する
   * @param fileName ファイル名 (例: "index.ts", "package.json")
   */
  public getFileIconUri(fileName: string): string {
    const cacheKey = fileName.toLowerCase();
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!;
    }

    let resolvedUri = '';

    // 1. アクティブなアイコンテーマからの解決を試行 (Material Icon Theme, vscode-icons 等)
    if (this.iconThemeData && this.themeDirectory) {
      resolvedUri = this.resolveIconFromTheme(fileName);
    }

    // 2. テーマから取得できなかった場合は組み込み SVG フォールバックを使用
    if (!resolvedUri) {
      resolvedUri = this.getFallbackSvgIcon(fileName);
    }

    this.iconCache.set(cacheKey, resolvedUri);
    return resolvedUri;
  }

  /**
   * テーマ定義 JSON からファイルアイコンの Data URI を解決する
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
        } catch (readErr) {
          console.warn(`アイコンファイルの読み込みに失敗しました (${absIconPath}):`, readErr);
        }
      }
    }

    return '';
  }

  /**
   * 主要な拡張子に対応する軽量・鮮明な内蔵 SVG アイコン (Data URI) を返す
   */
  private getFallbackSvgIcon(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();

    // 拡張子ごとのアイコンカラーとラベル
    const iconStyles: Record<string, { color: string; bg: string; label: string }> = {
      '.ts': { color: '#3178c6', bg: '#e8f0fe', label: 'TS' },
      '.tsx': { color: '#3178c6', bg: '#e8f0fe', label: 'TSX' },
      '.js': { color: '#f7df1e', bg: '#fefde8', label: 'JS' },
      '.jsx': { color: '#61dafb', bg: '#e8f9fe', label: 'JSX' },
      '.php': { color: '#777bb4', bg: '#eeeef7', label: 'PHP' },
      '.html': { color: '#e34f26', bg: '#fdeee8', label: 'HTM' },
      '.css': { color: '#1572b6', bg: '#e8f2fe', label: 'CSS' },
      '.scss': { color: '#c6538c', bg: '#feeff7', label: 'SCSS' },
      '.json': { color: '#cbcb41', bg: '#fefee8', label: '{}' },
      '.md': { color: '#083fa1', bg: '#e8f0fe', label: 'MD' },
      '.py': { color: '#3776ab', bg: '#e8f3fe', label: 'PY' },
      '.c': { color: '#555555', bg: '#f0f0f0', label: 'C' },
      '.cpp': { color: '#00599c', bg: '#e8f2fe', label: 'C++' },
      '.h': { color: '#a8b9cc', bg: '#f2f5f8', label: 'H' },
      '.java': { color: '#b07219', bg: '#fef5e8', label: 'JV' },
      '.rb': { color: '#cc342d', bg: '#feeee8', label: 'RB' },
      '.go': { color: '#00add8', bg: '#e8f9fe', label: 'GO' },
      '.rs': { color: '#dea584', bg: '#fdf7f4', label: 'RS' },
      '.sh': { color: '#4eaa25', bg: '#effeed', label: 'SH' },
      '.sql': { color: '#e38c00', bg: '#fef8e8', label: 'SQL' },
      '.xml': { color: '#e34f26', bg: '#fdeee8', label: 'XML' },
      '.yaml': { color: '#cb171e', bg: '#feebec', label: 'YML' },
      '.yml': { color: '#cb171e', bg: '#feebec', label: 'YML' },
      '.txt': { color: '#888888', bg: '#f5f5f5', label: 'TXT' }
    };

    const style = iconStyles[ext] || { color: '#888888', bg: '#f0f0f0', label: '' };

    // ラベル付き SVG または汎用ドキュメント SVG
    let svgContent = '';
    if (style.label) {
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
        <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.086a1.5 1.5 0 0 1 1.06.44l3.914 3.914a1.5 1.5 0 0 1 .44 1.06V14.5A1.5 1.5 0 0 1 13.5 16h-9A1.5 1.5 0 0 1 3 14.5v-13z" fill="${style.bg}" stroke="${style.color}" stroke-width="1"/>
        <path d="M9.5 0v4a1 1 0 0 0 1 1h4" fill="none" stroke="${style.color}" stroke-width="1"/>
        <text x="8" y="12.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="5.5" font-weight="bold" fill="${style.color}" text-anchor="middle">${style.label}</text>
      </svg>`;
    } else {
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h8l1-1V5l-.29-.71zM10 2.41L12.59 5H10V2.41zM4 14V2h5v4h4v8H4z" fill="#999999"/>
      </svg>`;
    }

    return `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
  }
}
