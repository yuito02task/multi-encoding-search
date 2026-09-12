import * as fs from 'fs';
import { SupportedEncoding } from './types';

/**
 * 言語固有文字分布・出現頻度モデルに基づく文字コード自動判定エンジン
 * EUC-JP, Shift_JIS, EUC-KR, UTF-8, Big5, GB18030, UTF-16 を厳密に識別
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

    // 3. 全文字 ASCII かチェック
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

    // 4. 厳密な UTF-8 妥当性検証
    let isStrictUtf8 = true;
    let utf8MultiByteCount = 0;
    let idx = 0;
    while (idx < len) {
      const b = buffer[idx];
      if (b <= 0x7F) {
        idx++;
      } else if ((b & 0xE0) === 0xC0) {
        if (b < 0xC2 || idx + 1 >= len || (buffer[idx + 1] & 0xC0) !== 0x80) {
          isStrictUtf8 = false;
          break;
        }
        utf8MultiByteCount++;
        idx += 2;
      } else if ((b & 0xF0) === 0xE0) {
        if (
          idx + 2 >= len ||
          (buffer[idx + 1] & 0xC0) !== 0x80 ||
          (buffer[idx + 2] & 0xC0) !== 0x80 ||
          (b === 0xE0 && buffer[idx + 1] < 0xA0) ||
          (b === 0xED && buffer[idx + 1] >= 0xA0)
        ) {
          isStrictUtf8 = false;
          break;
        }
        utf8MultiByteCount++;
        idx += 3;
      } else if ((b & 0xF8) === 0xF0) {
        if (
          idx + 3 >= len ||
          (buffer[idx + 1] & 0xC0) !== 0x80 ||
          (buffer[idx + 2] & 0xC0) !== 0x80 ||
          (buffer[idx + 3] & 0xC0) !== 0x80 ||
          (b === 0xF0 && buffer[idx + 1] < 0x90) ||
          (b === 0xF4 && buffer[idx + 1] > 0x8F)
        ) {
          isStrictUtf8 = false;
          break;
        }
        utf8MultiByteCount++;
        idx += 4;
      } else {
        isStrictUtf8 = false;
        break;
      }
    }

    if (isStrictUtf8 && utf8MultiByteCount > 0) {
      return 'utf-8';
    }

    // 5. 言語固有の特徴文字（頻度統計）の走査
    let eucJpHiragana = 0;
    let eucJpKatakana = 0;
    let eucJpKanji = 0;
    let sjisHiragana = 0;
    let sjisKatakana = 0;
    let sjisKanji = 0;
    let eucKrHangul = 0;
    let eucKrKana = 0;
    let eucKrHanja = 0;
    let cp949Extended = 0;
    let big5AsciiTrail = 0;
    let gb18030FourByte = 0;
    let totalNonAsciiBytes = 0;

    // 非ASCII文字の総数をカウント
    for (let i = 0; i < len; i++) {
      if (buffer[i] > 0x7F) totalNonAsciiBytes++;
    }

    // (A) EUC-JP / EUC-KR 走査 (0xA1..0xFE + 0xA1..0xFE)
    idx = 0;
    while (idx < len) {
      const b = buffer[idx];
      if (b <= 0x7F) {
        idx++;
      } else if (b >= 0xA1 && b <= 0xFE) {
        if (idx + 1 < len) {
          const b2 = buffer[idx + 1];
          if (b2 >= 0xA1 && b2 <= 0xFE) {
            // EUC-JP ひらがな (0xA4A1 - 0xA4F3)
            if (b === 0xA4 && b2 >= 0xA1 && b2 <= 0xF3) {
              eucJpHiragana++;
            }
            // EUC-JP カタカナ (0xA5A1 - 0xA5F6)
            else if (b === 0xA5 && b2 >= 0xA1 && b2 <= 0xF6) {
              eucJpKatakana++;
            }
            // EUC-KR 日本語ひらがな (KS X 1001: 0xAAA1 - 0xAAF3)
            else if (b === 0xAA && b2 >= 0xA1 && b2 <= 0xF3) {
              eucKrKana++;
            }
            // EUC-KR 日本語カタカナ (KS X 1001: 0xABA1 - 0xABF6)
            else if (b === 0xAB && b2 >= 0xA1 && b2 <= 0xF6) {
              eucKrKana++;
            }
            // EUC-KR ハングル完成型音節 (0xB0A1 - 0xC8FE: 가〜힣 2,350字)
            else if (b >= 0xB0 && b <= 0xC8) {
              eucKrHangul++;
            }
            // EUC-KR 漢字 (KS X 1001: 0xCAA1 - 0xFDFE)
            else if (b >= 0xCA && b <= 0xFD) {
              eucKrHanja++;
            }
            // EUC-JP 漢字 (JIS X 0208: 0xB0A1 - 0xF4FE)
            else if (b >= 0xB0 && b <= 0xF4) {
              eucJpKanji++;
            }
            idx += 2;
          } else {
            idx++;
          }
        } else {
          idx++;
        }
      } else if (b === 0x8E) {
        // EUC-JP 半角カナ (0x8E + 0xA1-0xDF)
        if (idx + 1 < len && buffer[idx + 1] >= 0xA1 && buffer[idx + 1] <= 0xDF) {
          eucJpKatakana++;
          idx += 2;
        } else {
          idx++;
        }
      } else if ((b >= 0x81 && b <= 0xA0) || (b >= 0xA1 && b <= 0xC6)) {
        // CP949 拡張ハングル領域
        if (idx + 1 < len) {
          const b2 = buffer[idx + 1];
          if ((b2 >= 0x41 && b2 <= 0x5A) || (b2 >= 0x61 && b2 <= 0x7A) || (b2 >= 0x81 && b2 <= 0xFE)) {
            cp949Extended++;
            idx += 2;
          } else {
            idx++;
          }
        } else {
          idx++;
        }
      } else {
        idx++;
      }
    }

    // (B) Shift_JIS 走査 (0x81..0x9F / 0xE0..0xFC + 0x40..0xFC)
    idx = 0;
    while (idx < len) {
      const b = buffer[idx];
      if (b <= 0x7F) {
        idx++;
      } else if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
        if (idx + 1 < len) {
          const b2 = buffer[idx + 1];
          if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) {
            // SJIS ひらがな (0x829F - 0x82F1)
            if (b === 0x82 && b2 >= 0x9F && b2 <= 0xF1) {
              sjisHiragana++;
            }
            // SJIS カタカナ (0x8340 - 0x8396)
            else if (b === 0x83 && b2 >= 0x40 && b2 <= 0x96) {
              sjisKatakana++;
            }
            // SJIS 漢字 (第1水準/第2水準)
            else if ((b >= 0x88 && b <= 0x9F) || (b >= 0xE0 && b <= 0xEA)) {
              sjisKanji++;
            }
            idx += 2;
          } else {
            idx++;
          }
        } else {
          idx++;
        }
      } else {
        idx++;
      }
    }

    // (C) Big5 走査 (0xA1..0xF9 + 0x40..0x7E: Big5 固有の ASCII トレイルバイト)
    idx = 0;
    while (idx < len) {
      const b = buffer[idx];
      if (b <= 0x7F) {
        idx++;
      } else if (b >= 0xA1 && b <= 0xF9) {
        if (idx + 1 < len) {
          const b2 = buffer[idx + 1];
          if (b2 >= 0x40 && b2 <= 0x7E) {
            big5AsciiTrail++;
            idx += 2;
          } else if (b2 >= 0xA1 && b2 <= 0xFE) {
            idx += 2;
          } else {
            idx++;
          }
        } else {
          idx++;
        }
      } else {
        idx++;
      }
    }

    // (D) GB18030 4バイトシーケンス走査 (0x81..0xFE 0x30..0x39 0x81..0xFE 0x30..0x39)
    idx = 0;
    while (idx + 3 < len) {
      const b1 = buffer[idx];
      const b2 = buffer[idx + 1];
      const b3 = buffer[idx + 2];
      const b4 = buffer[idx + 3];
      if (
        b1 >= 0x81 && b1 <= 0xFE &&
        b2 >= 0x30 && b2 <= 0x39 &&
        b3 >= 0x81 && b3 <= 0xFE &&
        b4 >= 0x30 && b4 <= 0x39
      ) {
        gb18030FourByte++;
        idx += 4;
      } else {
        idx++;
      }
    }

    // 6. 統計スコアリングに基づく決定ルール
    const eucJpScore = eucJpHiragana * 10 + eucJpKatakana * 5 + eucJpKanji;
    const sjisScore = sjisHiragana * 10 + sjisKatakana * 5 + sjisKanji;
    const eucKrScore = eucKrHangul * 10 + eucKrKana * 10 + eucKrHanja * 2 + cp949Extended * 8;

    // (1) EUC-KR のスコアが最も高い場合 (ハングルまたは KS X 1001 の日本語かな/漢字)
    if (eucKrScore > 0 && eucKrScore > eucJpScore && eucKrScore > sjisScore) {
      return 'euc-kr';
    }

    // (2) 日本語文字 (ひらがな・カタカナ・漢字) の比較 (EUC-JP vs Shift_JIS)
    if (eucJpScore > 0 && eucJpScore >= sjisScore) {
      return 'euc-jp';
    }
    if (sjisScore > 0 && sjisScore > eucJpScore) {
      return 'shift_jis';
    }

    // (3) Big5 固有の 2バイト目 (0x40-0x7E) が存在する場合
    if (big5AsciiTrail > 0 && eucJpScore === 0 && sjisScore === 0) {
      return 'big5';
    }

    // (4) GB18030 固有の 4バイト文字が存在する場合
    if (gb18030FourByte > 0) {
      return 'gb18030';
    }

    // (5) フォールバック判定
    if (eucKrScore > 0) {
      return 'euc-kr';
    }
    if (eucJpScore > 0) {
      return 'euc-jp';
    }
    if (sjisScore > 0) {
      return 'shift_jis';
    }

    // 非ASCII文字が存在するが特定不能な場合、UTF-8 が厳密妥当であれば UTF-8、そうでなければデフォルト
    return isStrictUtf8 ? 'utf-8' : 'utf-8';
  }
}
