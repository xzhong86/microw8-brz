const fs = require('node:fs');
const html = fs.readFileSync('dist/run-web.html', 'utf8').replace(/[ \t]+$/gm, '');
fs.writeFileSync('../src/run-web.html', html);
