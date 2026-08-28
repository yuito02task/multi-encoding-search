import * as fs from 'fs';
import { SupportedEncoding } from './types';

/**
 * WHATWG Encoding 規格 (TextDecoder) に基づく高精度文字コード自動判定エンジン
 */
export class EncodingDetector {
  /** 判定結果のキャッシュ (ファイルパス -> エンコーディング) */
  private static cache = new Map<string, { encoding: SupportedEncoding; mtimeMs: number }>();

  /**
   * ファイルパスからエンコーディングを判定する (キャッシュ対応)
   * @param filePath 判定対象のファイルパス
   * @returns 判定されたエンコーディング
   */
  public static detect(filePath: string): SupportedEncoding {
    try {
      const stat = fs.statSync(filePath);
      const cached = this.cache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.encoding;
      }

      // ファイル先頭から最大 256KB 読み込む
      const bufferSize = Math.min(stat.size, 256 * 1024);
      if (bufferSize === 0) {
        return 'utf-8';
      }

      const buffer = Buffer.alloc(bufferSize);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, bufferSize, 0);
      } finally {
        fs.closeSync(fd);
      }

      const encoding = this.detectFromBuffer(buffer);
      this.cache.set(filePath, { encoding, mtimeMs: stat.mtimeMs });
      return encoding;
    } catch {
      return 'utf-8';
    }
  }

  /**
   * バイトバッファからエンコーディングを自動判定する
   * @param buffer 検査対象のバイトバッファ
   * @returns 判定されたエンコーディング
   */
  public static detectFromBuffer(buffer: Buffer): SupportedEncoding {
    const len = buffer.length;
    if (len === 0) {
      return 'utf-8';
    }

    // 1. BOM (Byte Order Mark) による即時判定
    if (len >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return 'utf-8';
    }
    if (len >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      return 'utf-16le';
    }
    if (len >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
      return 'utf-16be';
    }

    // 2. UTF-16LE / UTF-16BE パターン判定 (BOMなしのNULLバイト交互出現)
    let nullEven = 0;
    let nullOdd = 0;
    const sampleSize = Math.min(len, 2048);
    for (let i = 0; i < sampleSize; i++) {
      if (buffer[i] === 0x00) {
        if (i % 2 === 0) nullEven++;
        else nullOdd++;
      }
    }
    if (sampleSize >= 32) {
      if (nullOdd > sampleSize * 0.3 && nullEven < sampleSize * 0.05) {
        return 'utf-16le';
      }
      if (nullEven > sampleSize * 0.3 && nullOdd < sampleSize * 0.05) {
        return 'utf-16be';
      }
    }

    // 3. ASCII のみかチェック
    let isAllAscii = true;
    for (let i = 0; i < len; i++) {
      if (buffer[i] > 0x7F) {
        isAllAscii = false;
        break;
      }
    }
    if (isAllAscii) {
      return 'utf-8';
    }

    // 4. UTF-8 の厳密デコード検証
    try {
      const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      utf8Decoder.decode(buffer);
      return 'utf-8';
    } catch {
      // UTF-8 ではない (レガシーエンコーディング)
    }

    // 5. 各エンコーディングでのデコード試行 & テキスト品質スコアリング
    const candidateEncodings: SupportedEncoding[] = [
      'euc-kr',
      'euc-jp',
      'shift_jis',
      'big5',
      'gb18030',
      'windows-1252'
    ];

    const results: Array<{ encoding: SupportedEncoding; score: number }> = [];

    for (const enc of candidateEncodings) {
      try {
        // WHATWG TextDecoder でデコード (不正シーケンスは fatal で弾く)
        // バッファ末尾でマルチバイトが切れている可能性を考慮し、fatal 失敗時はフォールバック
        let text = '';
        try {
          const fatalDecoder = new TextDecoder(enc, { fatal: true });
          text = fatalDecoder.decode(buffer);
        } catch {
          // 末尾を少し削って再試行
          if (buffer.length > 4) {
            const trimmedBuf = buffer.subarray(0, buffer.length - 4);
            const fatalDecoder = new TextDecoder(enc, { fatal: true });
            text = fatalDecoder.decode(trimmedBuf);
          } else {
            continue;
          }
        }

        let score = 0;

        // ハングル文字 (EUC-KR 特有の音節・字母)
        const hangul = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g);
        if (hangul) {
          if (enc === 'euc-kr') {
            score += 100 + hangul.length * 10;
          } else {
            score -= 50;
          }
        }

        // 日本語ひらがな・カタカナ (EUC-JP / Shift_JIS 特有)
        const kana = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g);
        if (kana) {
          if (enc === 'euc-jp' || enc === 'shift_jis') {
            score += 100 + kana.length * 10;
          } else {
            score -= 50;
          }
        }

        // CJK 統合漢字
        const kanji = text.match(/[\u4E00-\u9FAF\u3400-\u4DBF]/g);
        if (kanji) {
          score += kanji.length * 4;
        }

        // 誤デコードによる不自然な半角カナ連続 (SJIS / EUC-JP の典型的な文字化け)
        const halfKana = text.match(/[\uFF61-\uFF9F]/g);
        if (halfKana && (!kana || kana.length === 0)) {
          score -= halfKana.length * 15;
        }

        // 不正な制御文字のチェック
        const controlChars = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
        if (controlChars) {
          score -= controlChars.length * 30;
        }

        results.push({ encoding: enc, score });
      } catch {
        // このエンコーディングではデコード不可能
      }
    }

    // スコア順にソート
    results.sort((a, b) => b.score - a.score);

    if (results.length > 0 && results[0].score > 0) {
      return results[0].encoding;
    }

    return 'utf-8';
  }
}
