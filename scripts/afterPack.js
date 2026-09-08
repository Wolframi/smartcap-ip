/**
 * После сборки: встраиваем иконку и requestedExecutionLevel в exe через rcedit.
 * Используется т.к. signAndEditExecutable: false (иначе winCodeSign падает на symlinks в Windows).
 * Несколько попыток с задержкой — Windows может держать lock на файле после ASAR integrity step.
 */
const path = require('path');
const fs = require('fs');

const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') return;

    const exeName = context.packager.executableName || context.packager.productFilename || 'SmartCap';
    const exePath = path.join(context.appOutDir, `${exeName}.exe`);
    const iconPath = path.resolve(__dirname, '..', 'icon.ico');

    if (!fs.existsSync(exePath)) { console.warn('  • rcedit: exe не найден:', exePath); return; }
    if (!fs.existsSync(iconPath)) { console.warn('  • rcedit: icon.ico не найден:', iconPath); return; }

    const { rcedit } = await import('rcedit');

    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            await rcedit(exePath, {
                icon: iconPath,
                'requested-execution-level': 'asInvoker'
            });
            console.log(`  • rcedit: иконка и asInvoker применены к ${exeName}.exe (попытка ${attempt})`);
            return;
        } catch (err) {
            if (attempt < RETRY_COUNT) {
                console.warn(`  • rcedit: попытка ${attempt} неудачна (${err.message}), повтор через ${RETRY_DELAY_MS}ms...`);
                await sleep(RETRY_DELAY_MS);
            } else {
                console.warn(`  • rcedit: все ${RETRY_COUNT} попыток провалились: ${err.message}`);
            }
        }
    }
};
