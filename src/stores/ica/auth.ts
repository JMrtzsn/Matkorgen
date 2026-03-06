import { chromium, Browser } from 'playwright';
import dotenv from 'dotenv'; // Import dotenv

dotenv.config(); // Load environment variables from .env file

const AUTH_STATE_PATH = '.auth/state.json';
const BASE_URL = 'https://www.ica.se/'; // Starting point

async function authenticate(): Promise<void> {
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

    console.error(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL);

    // --- Handle Cookie Consent Banner ---
    const acceptCookiesSelector = 'button:has-text("Godkänn alla cookies"), #onetrust-accept-btn-handler';
    console.error(`Attempting to accept cookies with selector: ${acceptCookiesSelector}`);
    try {
      await page.waitForSelector(acceptCookiesSelector, { state: 'visible', timeout: 10000 });
      await page.click(acceptCookiesSelector);
      console.error('Clicked "Accept all cookies" button.');
      await page.waitForLoadState('networkidle'); // Wait for page to settle after accepting cookies
    } catch {
      console.error('Cookie consent banner not found or not clickable within timeout, proceeding...');
    }
    // --- End Cookie Consent Banner handling ---

    // --- Click initial "Logga in" button on www.ica.se ---
    const initialLoginButtonSelector = 'button:has-text("Logga in"), a:has-text("Logga in"), [data-qa="login-button"]';
    console.error(`Waiting for initial login button with selector: ${initialLoginButtonSelector}`);
    await page.waitForSelector(initialLoginButtonSelector, { state: 'visible', timeout: 15000 });
    await page.click(initialLoginButtonSelector);
    console.error('Clicked initial "Logga in" button.');

    // Wait for navigation or modal to appear after initial login click
    try {
      await page.waitForNavigation({ timeout: 15000 });
    } catch {
      console.error("No navigation detected within timeout after initial login click, assuming modal or in-page content change.");
    }
    console.error('Current URL after initial login click:', page.url());

    // --- Click "Fler inloggningssätt" button ---
    const moreLoginOptionsButtonSelector = 'button#more-button:has-text("Fler inloggningssätt")';
    console.error(`Waiting for "Fler inloggningssätt" button with selector: ${moreLoginOptionsButtonSelector}`);
    await page.waitForSelector(moreLoginOptionsButtonSelector, { state: 'visible', timeout: 15000 });
    await page.click(moreLoginOptionsButtonSelector);
    console.error('Clicked "Fler inloggningssätt" button.');

    // --- Click "Lösenord" link on the authentication choice page ---
    const passwordLoginLinkSelector = 'a.IcaCustomers:has-text("Lösenord")';
    console.error(`Waiting for "Lösenord" link with selector: ${passwordLoginLinkSelector}`);
    await page.waitForSelector(passwordLoginLinkSelector, { state: 'visible', timeout: 15000 });
    await page.click(passwordLoginLinkSelector);
    console.error('Clicked "Lösenord" link.');

    // Wait for navigation to the actual login form
    await page.waitForURL('https://ims.icagruppen.se/authn/authenticate/IcaCustomers', { timeout: 15000 });
    console.error('Navigated to actual login form:', page.url());

    // --- Fill login form and submit ---
    const usernameFieldSelector = 'input#userName';
    const passwordFieldSelector = 'input#password';
    const submitButtonSelector = 'button[type="submit"]:has-text("Logga in")';

    console.error(`Waiting for username field with selector: ${usernameFieldSelector}`);
    await page.waitForSelector(usernameFieldSelector, { state: 'visible', timeout: 10000 });
    console.error(`Waiting for password field with selector: ${passwordFieldSelector}`);
    await page.waitForSelector(passwordFieldSelector, { state: 'visible', timeout: 10000 });
    console.error(`Waiting for submit button with selector: ${submitButtonSelector}`);
    await page.waitForSelector(submitButtonSelector, { state: 'visible', timeout: 10000 });

    // Use environment variables for credentials
    const USERNAME = process.env.USERNAME;
    const PASSWORD = process.env.PASSWORD;

    if (!USERNAME || !PASSWORD) {
        throw new Error('USERNAME and PASSWORD environment variables must be set in your .env file.');
    }

    console.error(`Filling username field (${usernameFieldSelector})`);
    await page.fill(usernameFieldSelector, USERNAME);
    console.error(`Filling password field (${passwordFieldSelector})`);
    await page.fill(passwordFieldSelector, PASSWORD);
    
    console.error(`Clicking login submit button (${submitButtonSelector})`);
    await page.click(submitButtonSelector);

    // --- Wait for navigation after successful login ---
    console.error('Waiting for navigation after login submission...');
    await page.waitForNavigation({ timeout: 30000 }); // Increased timeout for post-login navigation
    console.error('Current URL after login submission:', page.url());

    console.error('Saving session state...');
    await context.storageState({ path: AUTH_STATE_PATH });
    console.error(`Session state saved to ${AUTH_STATE_PATH}`);

  } catch (error) {
    console.error('Authentication failed:', error, (error as Error).stack);
  } finally {
    if (browser) {
      await browser.close();
    }
    // TODO: Consider deleting .env file after usage for security
  }
}

authenticate();
