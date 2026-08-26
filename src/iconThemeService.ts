import * as path from 'path';

/**
 * ファイルアイコン提供サービス
 * 統一された美しい 16x16 ベクター SVG アイコンセットを提供
 */
export class FileIconService {
  private iconCache = new Map<string, string>();

  constructor() {
    this.iconCache.clear();
  }

  public refreshTheme(): void {
    this.iconCache.clear();
  }

  /**
   * 指定されたファイル名に対応する Data URI アイコンを取得
   * @param fileName ファイル名 (例: "index.ts", "package.json")
   */
  public getFileIconUri(fileName: string): string {
    const cacheKey = fileName.toLowerCase();
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!;
    }

    const uri = this.generateIcon(fileName);
    this.iconCache.set(cacheKey, uri);
    return uri;
  }

  /**
   * ファイル名・拡張子から統一された SVG アイコンを生成
   */
  private generateIcon(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    const ext = path.extname(lowerName);

    // 1. 特別なファイル名の判定
    if (lowerName === 'package.json' || lowerName === 'composer.json' || lowerName === 'cargo.toml') {
      return this.buildFileSvg('#cb3837', 'PKG');
    }
    if (lowerName === '.gitignore' || lowerName.startsWith('.git')) {
      return this.buildGitSvg('#f05032');
    }
    if (lowerName === 'dockerfile' || lowerName.endsWith('.dockerfile')) {
      return this.buildFileSvg('#2496ed', 'DCK');
    }
    if (lowerName === 'readme.md' || lowerName === 'readme.txt' || lowerName === 'license') {
      return this.buildFileSvg('#0288d1', 'INFO');
    }

    // 2. 拡張子別の判定
    switch (ext) {
      // TypeScript
      case '.ts':
      case '.tsx':
      case '.mts':
      case '.cts':
        return this.buildFileSvg('#3178c6', 'TS');

      // JavaScript
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return this.buildFileSvg('#e5a50a', 'JS');

      // PHP
      case '.php':
      case '.phtml':
      case '.php4':
      case '.php5':
      case '.php7':
      case '.inc':
        return this.buildFileSvg('#777bb4', 'PHP');

      // HTML / Web
      case '.html':
      case '.htm':
      case '.xhtml':
      case '.vue':
      case '.svelte':
        return this.buildFileSvg('#e34f26', 'HTML');

      // CSS / Styles
      case '.css':
      case '.scss':
      case '.sass':
      case '.less':
        return this.buildFileSvg('#1572b6', 'CSS');

      // JSON / Data
      case '.json':
      case '.jsonc':
      case '.json5':
        return this.buildFileSvg('#fbc02d', '{ }');

      // Markdown / Docs
      case '.md':
      case '.markdown':
      case '.mdown':
        return this.buildFileSvg('#42a5f5', 'MD');

      // Python
      case '.py':
      case '.pyw':
      case '.ipynb':
        return this.buildFileSvg('#3776ab', 'PY');

      // C / C++
      case '.c':
      case '.cpp':
      case '.cc':
      case '.cxx':
      case '.h':
      case '.hpp':
        return this.buildFileSvg('#00599c', 'C++');

      // Java
      case '.java':
      case '.class':
      case '.jar':
        return this.buildFileSvg('#e76f00', 'JAVA');

      // Ruby
      case '.rb':
      case '.erb':
        return this.buildFileSvg('#cc342d', 'RB');

      // Go
      case '.go':
        return this.buildFileSvg('#00add8', 'GO');

      // Rust
      case '.rs':
        return this.buildFileSvg('#dea584', 'RS');

      // Shell / Script
      case '.sh':
      case '.bash':
      case '.zsh':
      case '.bat':
      case '.cmd':
      case '.ps1':
        return this.buildFileSvg('#48bb78', '>_');

      // SQL / DB
      case '.sql':
      case '.db':
      case '.sqlite':
        return this.buildFileSvg('#e38c00', 'SQL');

      // XML / YAML / Config
      case '.xml':
      case '.svg':
        return this.buildFileSvg('#ff6d00', 'XML');
      case '.yaml':
      case '.yml':
        return this.buildFileSvg('#cb171e', 'YML');
      case '.env':
      case '.ini':
      case '.conf':
      case '.config':
      case '.toml':
        return this.buildFileSvg('#78909c', 'CFG');

      // Text / Log
      case '.txt':
      case '.log':
        return this.buildGenericTextSvg();

      // 画像ファイル
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.gif':
      case '.ico':
      case '.webp':
        return this.buildImageSvg();

      // 汎用デフォルト
      default:
        return this.buildDefaultFileSvg();
    }
  }

  /**
   * 統一規格のファイルアイコン SVG を生成
   * @param color メインアクセントカラー (枠線・テキスト)
   * @param label 中央テキスト
   */
  private buildFileSvg(color: string, label: string): string {
    // 文字数に応じたフォントサイズと位置調整
    const fontSize = label.length > 3 ? '4.2' : label.length > 2 ? '4.8' : '5.5';
    const yPos = '12';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <path d="M2.5 1.5C2.5 0.67 3.17 0 4 0h6.09c.4 0 .78.16 1.06.44l3.41 3.41c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-11C2.67 16 2 15.33 2 14.5v-13c0-.83.67-1.5 1.5-1.5z" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M10 0v3.5c0 .55.45 1 1 1h3.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <text x="8" y="${yPos}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="${color}" text-anchor="middle" letter-spacing="-0.2px">${label}</text>
    </svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }

  /**
   * Git 専用アイコン
   */
  private buildGitSvg(color: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <path d="M2.5 1.5C2.5 0.67 3.17 0 4 0h6.09c.4 0 .78.16 1.06.44l3.41 3.41c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-11C2.67 16 2 15.33 2 14.5v-13c0-.83.67-1.5 1.5-1.5z" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M10 0v3.5c0 .55.45 1 1 1h3.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <circle cx="6" cy="8" r="1.3" fill="${color}"/>
      <circle cx="10" cy="11.5" r="1.3" fill="${color}"/>
      <path d="M6 9.3v2.2M6 8c0 2 4 1.5 4 3.5" stroke="${color}" stroke-width="1.1" stroke-linecap="round" fill="none"/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }

  /**
   * 画像ファイル用アイコン
   */
  private buildImageSvg(): string {
    const color = '#ab47bc';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <path d="M2.5 1.5C2.5 0.67 3.17 0 4 0h6.09c.4 0 .78.16 1.06.44l3.41 3.41c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-11C2.67 16 2 15.33 2 14.5v-13c0-.83.67-1.5 1.5-1.5z" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M10 0v3.5c0 .55.45 1 1 1h3.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <circle cx="6" cy="7.5" r="1" fill="${color}"/>
      <path d="M4.5 13l3-3.5 2 2 1.5-1.5 2 3h-8.5z" fill="${color}"/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }

  /**
   * テキストファイル用アイコン
   */
  private buildGenericTextSvg(): string {
    const color = '#78909c';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <path d="M2.5 1.5C2.5 0.67 3.17 0 4 0h6.09c.4 0 .78.16 1.06.44l3.41 3.41c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-11C2.67 16 2 15.33 2 14.5v-13c0-.83.67-1.5 1.5-1.5z" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M10 0v3.5c0 .55.45 1 1 1h3.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M5 7.5h6M5 9.5h6M5 11.5h4" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }

  /**
   * 汎用デフォルトファイルアイコン
   */
  private buildDefaultFileSvg(): string {
    const color = '#90a4ae';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <path d="M2.5 1.5C2.5 0.67 3.17 0 4 0h6.09c.4 0 .78.16 1.06.44l3.41 3.41c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-11C2.67 16 2 15.33 2 14.5v-13c0-.83.67-1.5 1.5-1.5z" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M10 0v3.5c0 .55.45 1 1 1h3.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }
}
