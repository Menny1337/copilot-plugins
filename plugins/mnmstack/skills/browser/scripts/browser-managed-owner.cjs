'use strict';

const { writeFileSync } = require('node:fs');
const initialized = new WeakMap();
module.exports.default = async ({ page }) => {
  const context = page.context();
  if (!initialized.has(context)) {
    initialized.set(context, (async () => {
      const connection = await context.browser().newBrowserCDPSession();
      try {
        const { processInfo } = await connection.send('SystemInfo.getProcessInfo');
        const browser = processInfo.find(item => item.type === 'browser');
        if (!Number.isSafeInteger(browser?.id) || browser.id <= 0) throw new Error('Owned browser PID unavailable');
        writeFileSync(process.env.COPILOT_BROWSER_OWNER_FILE, JSON.stringify({
          ownerId: process.env.COPILOT_BROWSER_OWNER_ID,
          browserPid: browser.id,
          daemonPid: process.pid,
        }), { flag: 'wx', mode: 0o600 });
      } finally {
        await connection.detach();
      }
    })());
  }
  await initialized.get(context);
};
