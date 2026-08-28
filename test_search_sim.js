const path = require('path');
const { RipgrepRunner } = require('./out/ripgrepRunner');

const runner = new RipgrepRunner();
const rgPath = path.join(__dirname, 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe');
const workspaceFolders = [path.resolve(__dirname, 'test-samples')];

console.log('Testing search with search word: "html" (ASCII query in EUC-KR file)...');

runner.search(
  rgPath,
  workspaceFolders,
  {
    pattern: 'html',
    isCaseSensitive: false,
    isWordMatch: false,
    isRegexp: false,
    targetEncodings: ['utf-8', 'euc-jp', 'shift_jis', 'euc-kr', 'big5', 'gb18030']
  },
  (results, totalMatches, totalFiles) => {
    console.log('[Progress] totalFiles:', totalFiles, 'totalMatches:', totalMatches);
    for (const file of results) {
      console.log('  File:', file.fileName, 'primaryEncoding:', file.primaryEncoding);
      for (const m of file.matches) {
        console.log('    Line', m.lineNumber, 'encoding:', m.encoding, 'text:', m.lineText);
      }
    }
  },
  (totalMatches, totalFiles) => {
    console.log('[Complete] totalMatches:', totalMatches, 'totalFiles:', totalFiles);
  },
  (err) => {
    console.error('[Error]', err);
  }
);
