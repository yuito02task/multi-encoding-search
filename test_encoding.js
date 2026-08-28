const path = require('path');
const { EncodingDetector } = require('./out/encodingDetector');

const eucFile = path.resolve(__dirname, 'test-samples', 'sample_eucjp.php');
const sjisFile = path.resolve(__dirname, 'test-samples', 'sample_sjis.php');
const utf8File = path.resolve(__dirname, 'test-samples', 'sample_utf8.php');

console.log('EUC-JP sample detected as:', EncodingDetector.detect(eucFile));
console.log('Shift_JIS sample detected as:', EncodingDetector.detect(sjisFile));
console.log('UTF-8 sample detected as:', EncodingDetector.detect(utf8File));
