/**
 * Standalone ICA authentication script.
 *
 * Run once to persist a logged-in session to `.auth/state.json`.
 * Uses ICA_USERNAME / ICA_PASSWORD from the environment (or .env file).
 */

import { chromium, Browser } from 'playwright';
import dotenv from 'dotenv';
import { performLogin } from './login-flow';

dotenv.config();

const AUTH_STATE_PATH = '.auth/state.json';

async function authenticate(): Promise<void> {
  const username = process.env.ICA_USERNAME;
  const password = process.env.ICA_PASSWORD;

  if (!username || !password) {
    console.error('Error: ICA_USERNAME and ICA_PASSWORD must be set (in .env or shell).');
    process.exitCode = 1;
    return;
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'sv-SE',
      timezoneId: 'Europe/Stockholm',
      extraHTTPHeaders: {
        'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const page = await context.newPage();

    console.error('Navigating to https://www.ica.se/ ...');
    await page.goto('https://www.ica.se/', { waitUntil: 'domcontentloaded' });

    await performLogin(page, username, password);
    console.error('Current URL after login:', page.url());

    await context.storageState({ path: AUTH_STATE_PATH });
    console.error(`Session state saved to ${AUTH_STATE_PATH}`);
  } catch (error) {
    console.error('Authentication failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

authenticate();
