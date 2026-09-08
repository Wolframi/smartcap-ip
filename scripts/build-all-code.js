const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'SmartCap_ALL_CODE.txt');

const files = [
    'package.json',
    'jsconfig.json',
    'scripts/afterPack.js',
    'src/preload.js',
    'src/settings-preload.js',
    'src/main.js',
    'src/renderer/cropper.html',
    'src/renderer/cropper.css',
    'src/renderer/settings.html',
    'src/renderer/settings.css',
    'src/renderer/js/state.js',
    'src/renderer/js/smartboard-api.js',
    'src/renderer/js/blur.js',
    'src/renderer/js/canvas.js',
    'src/renderer/js/selection.js',
    'src/renderer/js/tools.js',
    'src/renderer/js/cropper-settings.js',
    'src/renderer/js/text.js',
    'src/renderer/js/ui.js',
    'src/renderer/js/float-mode.js',
    'src/renderer/js/float-edit.js',
    'src/renderer/js/forms.js',
    'src/renderer/js/create-defaults.js',
    'src/renderer/js/settings-board.js',
    'src/renderer/js/cropper-settings-panel.js',
    'src/renderer/js/cropper-app.js',
    'src/renderer/js/settings-app.js',
];

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dateStr = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
].join('-') + ' ' + [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join(':');

const header = [
    '================================================================================',
    '  SmartCap — полный дамп исходного кода',
    '  Папка проекта: C:/Users/polynskiyav/Desktop/MyProjectVS/SmartCap',
    '  Дата сборки: ' + dateStr,
    '================================================================================',
    '',
    'СТРУКТУРА ПРОЕКТА SmartCap:',
    '',
    'SmartCap/',
    '├── package.json              (npm scripts + electron-builder: build / nsis / portable)',
    '├── jsconfig.json',
    '├── icon.ico (бинарный)',
    '├── ico/ (PNG-иконки тулбара)',
    '├── scripts/afterPack.js      (post-build: rcedit — иконка exe, asInvoker)',
    '├── src/preload.js',
    '├── src/settings-preload.js',
    '├── src/main.js',
    '├── src/renderer/cropper.html',
    '├── src/renderer/cropper.css',
    '├── src/renderer/settings.html',
    '├── src/renderer/settings.css',
    '└── src/renderer/js/ (state, smartboard-api, blur, canvas, selection, tools,',
    '                     cropper-settings, text, ui, float-mode, float-edit, forms,',
    '                     create-defaults, settings-board, cropper-settings-panel,',
    '                     cropper-app, settings-app)',
    '',
    'СБОРКА (npm scripts из package.json):',
    '  npm run start          — запуск в dev (electron .)',
    '  npm run build          — electron-builder --win (nsis + portable)',
    '  npm run build:portable — только portable exe',
    '  npm run build:dir      — распакованная папка dist/win-unpacked',
    '',
    '================================================================================',
    '  СОДЕРЖИМОЕ ФАЙЛОВ',
    '================================================================================',
    '',
].join('\n');

let body = '';
let totalLines = 0;

for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
        console.error('Missing file:', rel);
        process.exit(1);
    }
    const content = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    totalLines += content.split('\n').length;
    const label = 'SmartCap\\\\' + rel.replace(/\//g, '\\\\');
    body += '\n\n################################################################################\n';
    body += '# ФАЙЛ: ' + label + '\n';
    body += '################################################################################\n\n\n';
    body += content;
    if (!body.endsWith('\n')) body += '\n';
}

fs.writeFileSync(out, header + body, 'utf8');
console.log('Written:', out);
console.log('Files:', files.length);
console.log('Total source lines:', totalLines);
console.log('Output size:', fs.statSync(out).size, 'bytes');
