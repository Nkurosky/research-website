const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'studies', 'league-decision-task');
const localRoot = process.argv[2];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

async function main() {
  // Use the actual pinned jsPsych libraries, but intercept all collector traffic.
  const dependencies = new Map();
  for (const url of [
    'https://unpkg.com/jspsych@7.3.4/dist/index.browser.js',
    'https://unpkg.com/@jspsych/plugin-html-button-response@1.2.0/dist/index.browser.js',
    'https://unpkg.com/@jspsych/plugin-survey-text@1.1.3/dist/index.browser.js'
  ]) {
    const response = await fetch(url);
    assert(response.ok, `Dependency unavailable: ${url}`);
    dependencies.set(url, await response.text());
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const local = url.pathname.startsWith('/local/');
      const base = local ? localRoot : root;
      if (!base) throw new Error('Unknown fixture');
      const relative = url.pathname.replace(/^\/(study|local)\//, '') || 'index.html';
      const file = path.resolve(base, relative);
      if (!file.startsWith(path.resolve(base) + path.sep)) throw new Error('Invalid path');
      response.setHeader('Content-Type', mime[path.extname(file)] || 'text/plain');
      response.end(await fs.readFile(file));
    } catch (_) { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let passed = 0;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    async function fixture(options = {}) {
      const context = await browser.newContext(options);
      const posts = [];
      const errors = [];
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.startsWith(origin)) return route.continue();
        if (dependencies.has(url)) return route.fulfill({ contentType: 'text/javascript', body: dependencies.get(url) });
        if (url.startsWith('https://collect.nathankurosky.com')) {
          if (route.request().method() === 'POST') posts.push(route.request().postDataJSON());
          return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
        }
        return route.fulfill({ body: '' });
      });
      context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      const page = await context.newPage();
      return { context, page, posts, errors };
    }
    async function submit(page, age, residence) {
      await page.locator(`input[name=age][value=${age}]`).check();
      await page.locator(`input[name=residence][value=${residence}]`).check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    async function blocked(page) {
      await page.getByRole('heading', { name: 'Not eligible to participate' }).waitFor();
      assert.equal(await page.locator('script[src*="experiment.js"]').count(), 0);
    }
    for (const section of localRoot ? ['study', 'local'] : ['study']) {
      const url = `${origin}/${section}/`;
      for (const [age, residence] of [['under18', 'US'], ['under18', 'CA'], ['under18', 'other'], ['adult', 'other']]) {
        const { context, page, posts, errors } = await fixture();
        await page.goto(url);
        await submit(page, age, residence);
        await blocked(page);
        await page.reload();
        await blocked(page);
        const another = await context.newPage();
        await another.goto(`${url}?edit=1`);
        await blocked(another);
        assert.equal(posts.length, 0, 'Screen-outs must never upload');
        assert.deepEqual(errors, []);
        await context.close();
        passed++;
      }
      for (const residence of ['US', 'CA']) {
        const { context, page, posts, errors } = await fixture();
        await page.goto(url);
        // Native validation: neither question can be skipped.
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        assert.equal(await page.locator('script[src*="experiment.js"]').count(), 0);
        await page.locator('input[name=age][value=adult]').check();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        assert.equal(await page.locator('script[src*="experiment.js"]').count(), 0);
        await submit(page, 'adult', residence);
        await page.getByRole('heading', { name: 'Welcome to the League Decision Task' }).waitFor();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('heading', { name: 'Experiment Instructions' }).waitFor();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('heading', { name: 'Pre-experiment Survey' }).waitFor();
        for (const [name, value] of Object.entries({ rank: 'Gold IV', current_rank: 'Gold IV', hours: '10', playstyle_aggression: '4', role: 'Mid' })) {
          await page.locator(`input[data-name="${name}"]`).fill(value);
        }
        const riotId = page.getByRole('textbox', { name: 'Riot ID (Username#Tag)' });
        for (const invalid of ['', 'Lokidosi', '#IUB', 'Lokidosi#', ' #IUB', 'Lokidosi#IUB#extra', 'Lokidosi#   ']) {
          await riotId.fill(invalid);
          await page.getByRole('button', { name: 'Continue', exact: true }).click();
          assert.equal(await page.getByRole('heading', { name: 'Pre-experiment Survey' }).count(), 1);
          assert.equal(await page.evaluate(() => jsPsych.data.get().values().some((row) => row.trial_type === 'survey-text')), false);
        }
        await riotId.fill(' Lokidosi#IUB ');
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('heading', { name: 'Confidence Slider Instructions' }).waitFor();
        const exported = await page.evaluate(() => {
          const currentRows = jsPsych.data.get().values();
          const metadata = currentRows[0];
          return buildSpreadsheetResult([...currentRows, { ...metadata, event_type: 'decision', stimulus_id: 'trial4', decision: 'FIGHT' }]);
        });
        const rows = exported.trim().split(/\r?\n/).map((row) => row.split('\t'));
        assert.equal(rows[0].length, rows[1].length);
        assert.equal(rows[1][rows[0].indexOf('"eligibility_country_of_residence"')], `"${residence}"`);
        assert.equal(rows[1][rows[0].indexOf('"eligibility_age_18_or_older"')], '"true"');
        assert.equal(rows[1][rows[0].indexOf('"survey_riot_id"')], '"Lokidosi#IUB"');
        assert.equal(await page.evaluate(() => localStorage.getItem('league-study-eligibility-blocked')), null);
        if (section === 'study') assert(posts.length > 0, 'Eligible flow still autosaves');
        assert.deepEqual(errors, []);
        await context.close();
        passed++;
      }
    }

    // Either persistence mechanism alone must preserve a screen-out.
    for (const remove of ['cookies', 'localStorage']) {
      const { context, page } = await fixture();
      await page.goto(`${origin}/study/`);
      await submit(page, 'under18', 'US');
      await blocked(page);
      if (remove === 'cookies') await context.clearCookies();
      else await page.evaluate(() => localStorage.clear());
      const savedState = await context.storageState();
      await context.close();
      const resumed = await fixture({ storageState: savedState });
      await resumed.page.goto(`${origin}/study/`);
      await blocked(resumed.page);
      assert.equal(resumed.posts.length, 0);
      await resumed.context.close();
      passed++;
    }

    // If localStorage is unavailable, the cookie still blocks a later visit.
    {
      const { context, page, posts, errors } = await fixture();
      await context.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); };
        Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
      });
      await page.goto(`${origin}/study/`);
      await submit(page, 'under18', 'CA');
      await blocked(page);
      await page.reload();
      await blocked(page);
      assert.equal(posts.length, 0);
      assert.deepEqual(errors, []);
      await context.close();
      passed++;
    }

    // A screen-out in another tab ends an already admitted session.
    {
      const { context, page, posts, errors } = await fixture();
      await page.goto(`${origin}/study/`);
      await submit(page, 'adult', 'US');
      await page.getByRole('heading', { name: 'Welcome to the League Decision Task' }).waitFor();
      const other = await context.newPage();
      await other.goto(`${origin}/study/`);
      await submit(other, 'adult', 'other');
      await blocked(other);
      await blocked(page);
      assert.equal(posts.length, 0);
      assert.deepEqual(errors, []);
      await context.close();
      passed++;
    }

    // Verify rendering at narrow and desktop widths; keep screenshots local.
    const output = path.resolve(__dirname, '..', '.wrangler', 'eligibility-qa');
    await fs.mkdir(output, { recursive: true });
    for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
      const { context, page } = await fixture({ viewport });
      await page.goto(`${origin}/study/`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `screening-${viewport.width}.png`), fullPage: true });
      await submit(page, 'under18', 'CA');
      await page.screenshot({ path: path.join(output, `blocked-${viewport.width}.png`), fullPage: true });
      await context.close();
      passed++;
    }
    console.log(`PASS: ${passed} browser scenarios; collector requests mocked, no production data written.`);
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
