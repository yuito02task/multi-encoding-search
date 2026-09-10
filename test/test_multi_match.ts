import * as path from 'path';
import * as fs from 'fs';
import { RipgrepRunner } from '../src/ripgrepRunner';
import { FileSearchResult } from '../src/types';

// テスト用の一時ファイルを作成
const testDir = path.join(__dirname, 'test_sandbox');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// 1行に複数マッチが含まれるテストファイル
const testFilePath = path.join(testDir, 'sample.txt');
fs.writeFileSync(testFilePath, 'apple banana apple cherry apple\nsecond line with apple\n', 'utf8');

const runner = new RipgrepRunner();

// ripgrep のパスを取得
// @ts-ignore
const { rgPath } = require('@vscode/ripgrep');

console.log('Testing with rgPath:', rgPath);

runner.search(
  rgPath,
  [testDir],
  {
    pattern: 'apple',
    isRegexp: false,
    isCaseSensitive: false,
    isWordMatch: false,
    targetEncodings: ['utf-8']
  },
  (_results: FileSearchResult[], _totalMatches: number, _totalFiles: number) => {
    // progress
  },
  (totalMatches: number, totalFiles: number) => {
    console.log(`Search Complete: totalMatches=${totalMatches}, totalFiles=${totalFiles}`);
    if (totalMatches === 4) {
      console.log('SUCCESS: Exactly 4 matches found (3 in line 1, 1 in line 2)');
    } else {
      console.error(`FAILURE: Expected 4 matches, got ${totalMatches}`);
      process.exit(1);
    }
    // 後片付け
    fs.rmSync(testDir, { recursive: true, force: true });
  },
  (err: string) => {
    console.error('Error during search:', err);
    process.exit(1);
  }
);
