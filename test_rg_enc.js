const cp = require('child_process');
const path = require('path');
const rgPath = path.join(__dirname, 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe');

const encodings = ['utf-8', 'euc-jp', 'shift_jis', 'sjis', 'euc-kr', 'euckr', 'korean', 'big5', 'gb18030', 'gbk', 'windows-1252', 'latin1', 'utf-16le', 'utf-16be'];

for (const enc of encodings) {
  try {
    const res = cp.spawnSync(rgPath, ['--encoding', enc, '--json', 'test', 'test-samples'], { encoding: 'utf8' });
    if (res.stderr && res.stderr.includes('encoding')) {
      console.log(`[FAIL] ${enc}: ${res.stderr.trim()}`);
    } else {
      console.log(`[OK] ${enc}`);
    }
  } catch (e) {
    console.log(`[ERR] ${enc}: ${e.message}`);
  }
}
