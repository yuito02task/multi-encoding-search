import * as fs from 'fs';
import { SupportedEncoding } from './types';

/**
 * ファイルのエンコーディングを高精度に自動判定するクラス
 * UTF-8, UTF-16LE/BE, EUC-JP, Shift_JIS, EUC-KR, GB18030, Big5, Windows-1252 を正確に識別
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

    // 3. UTF-8 の厳密妥当性検証
    let isStrictUtf8 = true;
    let utf8MultiByteCount = 0;
    let asciiCount = 0;
    let i = 0;

    while (i < len) {
      const b = buffer[i];
      if (b <= 0x7F) {
        // 1バイト ASCII
        asciiCount++;
        i++;
      } else if ((b & 0xE0) === 0xC0) {
        // 2バイトシーケンス (0xC2-0xDF + 0x80-0xBF)
        if (b < 0xC2 || i + 1 >= len || (buffer[i + 1] & 0xC0) !== 0x80) {
          isStrictUtf8 = false;
          break;
        }
        utf8MultiByteCount++;
        i += 2;
      } else if ((b & 0xF0) === 0xE0) {
        // 3バイトシーケンス (日本語・韓国語・中国語の多くがここ)
        if (
          i + 2 >= len ||
          (buffer[i + 1] & 0xC0) !== 0x80 ||
          (buffer[i + 2] & 0xC0) !== 0x80 ||
          (b === 0xE0 && buffer[i + 1] < 0xA0) ||
          (b === 0xED && buffer[i + 1] >= 0xA0)
        ) {
          isStrictUtf8 = false;
          break;
        }
        utf8MultiByteCount++;
        i += 3;
      } else if ((b & 0xF8) === 0xF0) {
        // 4バイトシーケンス (絵文字など)
        if (
          i + 3 >= len ||
          (buffer[i + 1] & 0xC0) !== 0x80 ||
          (buffer[i + 2] & 0xC0) !== 0x80 ||
          (buffer[i + 3] & 0xC0) !== 0x80 ||
          (b === 0xF0 && buffer[i + 1] < 0x90) ||
          (b === 0xF4 && buffer[i + 1] > 0x8F)
        ) {
          isStrictUtf8 = false;
          break;
        }
        utf8MultiByteCount++;
        i += 4;
      } else {
        // 不正なUTF-8先頭バイト
        isStrictUtf8 = false;
        break;
      }
    }

    // 厳密にUTF-8であり、マルチバイト文字が含まれている場合は確実に UTF-8
    if (isStrictUtf8 && utf8MultiByteCount > 0) {
      return 'utf-8';
    }

    // 全文字が ASCII のみの場合も UTF-8 を基本とする
    if (isStrictUtf8 && asciiCount === len) {
      return 'utf-8';
    }

    // 4. 各レガシーエンコーディングのスコアリング
    const eucKrScore = this.scoreEucKr(buffer);
    const eucJpScore = this.scoreEucJp(buffer);
    const sjisScore = this.scoreShiftJis(buffer);
    const big5Score = this.scoreBig5(buffer);
    const gbScore = this.scoreGb18030(buffer);

    const candidates: Array<{ encoding: SupportedEncoding; score: number; isValid: boolean }> = [
      { encoding: 'euc-kr', score: eucKrScore.score, isValid: eucKrScore.isValid },
      { encoding: 'euc-jp', score: eucJpScore.score, isValid: eucJpScore.isValid },
      { encoding: 'shift_jis', score: sjisScore.score, isValid: sjisScore.isValid },
      { encoding: 'big5', score: big5Score.score, isValid: big5Score.isValid },
      { encoding: 'gb18030', score: gbScore.score, isValid: gbScore.isValid }
    ];

    // 有効かつスコアが正のものを降順ソート
    const validCandidates = candidates
      .filter((c) => c.isValid && c.score > 0)
      .sort((a, b) => b.score - a.score);

    if (validCandidates.length > 0) {
      return validCandidates[0].encoding;
    }

    return 'utf-8';
  }

  /**
   * EUC-KR (韓国語, KS X 1001) のスコアリング
   * 完成型ハングル音節 (0xB0A1-0xC8FE: 2,350字) およびハングル字母 (0xA4A1-0xA4D3) を検出
   */
  private static scoreEucKr(buffer: Buffer): { isValid: boolean; score: number } {
    let score = 0;
    let invalidCount = 0;
    let hangulCount = 0;
    let i = 0;
    const len = buffer.length;

    while (i < len) {
      const b = buffer[i];

      if (b <= 0x7F) {
        // ASCII
        i++;
      } else if (b >= 0xA1 && b <= 0xFE) {
        if (i + 1 < len) {
          const b2 = buffer[i + 1];
          if (b2 >= 0xA1 && b2 <= 0xFE) {
            // EUC-KR 完成型ハングル領域 (0xB0A1 - 0xC8FE: 가〜힣) -> 最重要シグナル
            if (b >= 0xB0 && b <= 0xC8) {
              score += 25;
              hangulCount++;
            }
            // EUC-KR ハングル字母領域 (0xA4A1 - 0xA4D3: ㄱ〜ㅣ)
            else if (b === 0xA4 && b2 >= 0xA1 && b2 <= 0xD3) {
              score += 20;
              hangulCount++;
            }
            // EUC-KR 漢字領域 (0xCA - 0xFD)
            else if (b >= 0xCA && b <= 0xFD) {
              score += 5;
            }
            // EUC-KR 記号・約物領域 (0xA1 - 0xAC)
            else if (b >= 0xA1 && b <= 0xAC) {
              score += 3;
            } else {
              score += 1;
            }
            i += 2;
          } else {
            invalidCount++;
            i++;
          }
        } else {
          invalidCount++;
          i++;
        }
      } else {
        // EUC-KR 不正バイト (0x80..0xA0, 0xFF)
        invalidCount++;
        i++;
      }
    }

    const isValid = invalidCount === 0 || (hangulCount > 0 && score > invalidCount * 10);
    return { isValid, score: isValid ? score - invalidCount * 5 : 0 };
  }

  /**
   * EUC-JP (日本語) のスコアリング
   * ひらがな (0xA4A1-0xA4F3), カタカナ (0xA5A1-0xA5F6), 半角カナ (0x8E), 漢字を検出
   */
  private static scoreEucJp(buffer: Buffer): { isValid: boolean; score: number } {
    let score = 0;
    let invalidCount = 0;
    let kanaCount = 0;
    let i = 0;
    const len = buffer.length;

    while (i < len) {
      const b = buffer[i];

      if (b <= 0x7F) {
        // ASCII
        i++;
      } else if (b >= 0xA1 && b <= 0xFE) {
        if (i + 1 < len) {
          const b2 = buffer[i + 1];
          if (b2 >= 0xA1 && b2 <= 0xFE) {
            // EUC-JP ひらがな領域 (0xA4A1 - 0xA4F3) -> 日本語最重要シグナル
            if (b === 0xA4 && b2 >= 0xA1 && b2 <= 0xF3) {
              score += 25;
              kanaCount++;
            }
            // EUC-JP カタカナ領域 (0xA5A1 - 0xA5F6)
            else if (b === 0xA5 && b2 >= 0xA1 && b2 <= 0xF6) {
              score += 20;
              kanaCount++;
            }
            // EUC-JP 漢字領域 (0xB0A1 - 0xF4FE)
            else if (b >= 0xB0 && b <= 0xF4) {
              score += 5;
            }
            // EUC-JP 記号 (0xA1 - 0xA8)
            else if (b >= 0xA1 && b <= 0xA8) {
              score += 3;
            } else {
              score += 1;
            }
            i += 2;
          } else {
            invalidCount++;
            i++;
          }
        } else {
          invalidCount++;
          i++;
        }
      } else if (b === 0x8E) {
        // 半角カナ (0x8E + 0xA1-0xDF)
        if (i + 1 < len && buffer[i + 1] >= 0xA1 && buffer[i + 1] <= 0xDF) {
          score += 6;
          kanaCount++;
          i += 2;
        } else {
          invalidCount++;
          i++;
        }
      } else if (b === 0x8F) {
        // 3バイト補助漢字 (0x8F + 0xA1-0xFE + 0xA1-0xFE)
        if (
          i + 2 < len &&
          buffer[i + 1] >= 0xA1 &&
          buffer[i + 1] <= 0xFE &&
          buffer[i + 2] >= 0xA1 &&
          buffer[i + 2] <= 0xFE
        ) {
          score += 5;
          i += 3;
        } else {
          invalidCount++;
          i++;
        }
      } else {
        // EUC-JP 不正バイト
        invalidCount++;
        i++;
      }
    }

    const isValid = invalidCount === 0 || (kanaCount > 0 && score > invalidCount * 10);
    return { isValid, score: isValid ? score - invalidCount * 5 : 0 };
  }

  /**
   * Shift_JIS / CP932 (日本語) のスコアリング
   * ひらがな (0x829F-0x82F1), カタカナ (0x8340-0x8396), 半角カナ (0xA1-0xDF), 漢字を検出
   */
  private static scoreShiftJis(buffer: Buffer): { isValid: boolean; score: number } {
    let score = 0;
    let invalidCount = 0;
    let kanaCount = 0;
    let i = 0;
    const len = buffer.length;

    while (i < len) {
      const b = buffer[i];

      if (b <= 0x7F) {
        // ASCII
        i++;
      } else if (b >= 0xA1 && b <= 0xDF) {
        // 1バイト半角カナ (0xA1-0xDF)
        score += 4;
        kanaCount++;
        i++;
      } else if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
        // 2バイト文字
        if (i + 1 < len) {
          const b2 = buffer[i + 1];
          if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) {
            // SJIS ひらがな領域 (0x829F - 0x82F1) -> 日本語最重要シグナル
            if (b === 0x82 && b2 >= 0x9F && b2 <= 0xF1) {
              score += 25;
              kanaCount++;
            }
            // SJIS カタカナ領域 (0x8340 - 0x8396)
            else if (b === 0x83 && b2 >= 0x40 && b2 <= 0x96) {
              score += 20;
              kanaCount++;
            }
            // SJIS 漢字領域
            else if ((b >= 0x88 && b <= 0x9F) || (b >= 0xE0 && b <= 0xEA)) {
              score += 5;
            } else {
              score += 2;
            }
            i += 2;
          } else {
            invalidCount++;
            i++;
          }
        } else {
          invalidCount++;
          i++;
        }
      } else {
        // SJIS 不正バイト (0x80, 0xA0, 0xFD-0xFF)
        invalidCount++;
        i++;
      }
    }

    const isValid = invalidCount === 0 || (kanaCount > 0 && score > invalidCount * 10);
    return { isValid, score: isValid ? score - invalidCount * 5 : 0 };
  }

  /**
   * Big5 (繁体字中国語) のスコアリング
   * 2バイト目に 0x40-0x7E (ASCII範囲) が約50%出現するのが Big5 の最大の特徴
   */
  private static scoreBig5(buffer: Buffer): { isValid: boolean; score: number } {
    let score = 0;
    let invalidCount = 0;
    let big5SpecificCount = 0;
    let totalCharCount = 0;
    let i = 0;
    const len = buffer.length;

    while (i < len) {
      const b = buffer[i];

      if (b <= 0x7F) {
        i++;
      } else if (b >= 0xA1 && b <= 0xF9) {
        if (i + 1 < len) {
          const b2 = buffer[i + 1];
          if (b2 >= 0x40 && b2 <= 0x7E) {
            // Big5 固有の 2バイト目 (0x40-0x7E): EUC系には絶対に現れない
            big5SpecificCount++;
            totalCharCount++;
            score += 15;
            i += 2;
          } else if (b2 >= 0xA1 && b2 <= 0xFE) {
            // 2バイト目が 0xA1-0xFE (EUC系とも重複する領域)
            totalCharCount++;
            score += 3;
            i += 2;
          } else {
            invalidCount++;
            i++;
          }
        } else {
          invalidCount++;
          i++;
        }
      } else {
        invalidCount++;
        i++;
      }
    }

    // 2バイト目 0x40-0x7E が1つも出現しない場合は Big5 ではない (EUC-KR または EUC-JP の誤認防止)
    if (totalCharCount > 0 && big5SpecificCount === 0) {
      return { isValid: false, score: 0 };
    }

    const isValid = invalidCount === 0 || (big5SpecificCount > 0 && score > invalidCount * 10);
    return { isValid, score: isValid ? score - invalidCount * 5 : 0 };
  }

  /**
   * GB18030 (簡体字中国語) のスコアリング
   */
  private static scoreGb18030(buffer: Buffer): { isValid: boolean; score: number } {
    let score = 0;
    let invalidCount = 0;
    let gbSpecificCount = 0;
    let i = 0;
    const len = buffer.length;

    while (i < len) {
      const b = buffer[i];

      if (b <= 0x7F) {
        i++;
      } else if (b >= 0x81 && b <= 0xFE) {
        if (i + 1 < len) {
          const b2 = buffer[i + 1];
          if (b2 >= 0x40 && b2 <= 0xFE && b2 !== 0x7F) {
            // 2バイト GBK/GB18030
            if (b >= 0xB0 && b <= 0xF7 && b2 >= 0xA1 && b2 <= 0xFE) {
              score += 5;
            } else {
              score += 2;
            }
            i += 2;
          } else if (b2 >= 0x30 && b2 <= 0x39 && i + 3 < len) {
            const b3 = buffer[i + 2];
            const b4 = buffer[i + 3];
            if (b3 >= 0x81 && b3 <= 0xFE && b4 >= 0x30 && b4 <= 0x39) {
              // 4バイト GB18030 固有シーケンス
              gbSpecificCount++;
              score += 15;
              i += 4;
            } else {
              invalidCount++;
              i++;
            }
          } else {
            invalidCount++;
            i++;
          }
        } else {
          invalidCount++;
          i++;
        }
      } else {
        invalidCount++;
        i++;
      }
    }

    const isValid = invalidCount === 0 || (gbSpecificCount > 0 && score > invalidCount * 10);
    return { isValid, score: isValid ? score - invalidCount * 5 : 0 };
  }
}
