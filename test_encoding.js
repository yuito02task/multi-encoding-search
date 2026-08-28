const path = require('path');
const { EncodingDetector } = require('./out/encodingDetector');

const eucFile = path.resolve(__dirname, 'test-samples', 'sample_eucjp.php');
const sjisFile = path.resolve(__dirname, 'test-samples', 'sample_sjis.php');
const utf8File = path.resolve(__dirname, 'test-samples', 'sample_utf8.php');
const eucKrFile = path.resolve(__dirname, 'test-samples', 'sample_euckr.txt');
const eucKrHtmlFile = path.resolve(__dirname, 'test-samples', 'sample_euckr_html.html');

console.log('EUC-JP sample:', EncodingDetector.detect(eucFile));
console.log('Shift_JIS sample:', EncodingDetector.detect(sjisFile));
console.log('UTF-8 sample:', EncodingDetector.detect(utf8File));
console.log('EUC-KR sample (txt):', EncodingDetector.detect(eucKrFile));
console.log('EUC-KR sample (html):', EncodingDetector.detect(eucKrHtmlFile));
