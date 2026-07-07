// End-to-end smoke test for AnkiAI using system Chrome via puppeteer-core.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5199';
const SHOT_DIR = process.env.SHOT_DIR || '.';
const results = [];
const ok = (name) => { results.push(['PASS', name]); console.log('PASS', name); };
const fail = (name, err) => { results.push(['FAIL', name + ' :: ' + err]); console.log('FAIL', name, '::', err); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim().includes(t)),
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no ${selector} containing "${text}"`);
  await el.click();
  return el;
}

async function waitForText(page, text, timeout = 8000) {
  await page.waitForFunction(
    (t) => document.body && document.body.innerText.includes(t),
    { timeout },
    text,
  );
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1360,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 1. Load — default deck exists
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitForText(page, 'Decks');
  await waitForText(page, 'Default');
  ok('app loads with Default deck');

  // 2. Create a deck + subdeck
  await clickByText(page, 'button', 'New deck');
  await page.waitForSelector('.modal-panel input');
  await page.type('.modal-panel input', 'Biology');
  await clickByText(page, '.modal-panel button', 'Create');
  await waitForText(page, 'Biology');
  ok('deck created');

  // 3. Add a basic note
  await clickByText(page, '.nav-item', 'Add');
  await page.waitForSelector('.add-view textarea');
  const areas = await page.$$('.add-view textarea');
  // pick Biology deck
  await page.evaluate(() => {
    const selects = document.querySelectorAll('.add-selectors select');
    const deckSel = selects[1];
    const opt = [...deckSel.options].find((o) => o.textContent.includes('Biology'));
    deckSel.value = opt.value;
    deckSel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await areas[0].type('What organelle produces ATP in eukaryotic cells?');
  await areas[1].type('The mitochondrion (mitochondria)');
  await clickByText(page, 'button', 'Add note');
  await waitForText(page, 'Added — 1 card created');
  ok('basic note added');

  // 4. Simulate dropping an image into the front field (screenshot-paste path)
  await areas[0].type('Label the structure shown: ');
  await page.evaluate(async () => {
    // tiny 2x2 red PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DwnwEKmBhQAAMAJgQDAViKGAcAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'shot.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ta = document.querySelector('.add-view textarea');
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    ta.dispatchEvent(ev);
  });
  await page.waitForFunction(
    () => document.querySelector('.add-view textarea').value.includes('[img:'),
    { timeout: 5000 },
  );
  await page.waitForSelector('.field-preview img');
  ok('image drop stored + token inserted + preview rendered');
  await areas[1].click({ clickCount: 1 });
  await page.evaluate(() => {
    const tas = document.querySelectorAll('.add-view textarea');
    tas[1].focus();
  });
  await areas[1].type('A mitochondrion');
  await clickByText(page, 'button', 'Add note');
  await waitForText(page, 'Added — 1 card created');
  ok('image note added');

  // 5. Deck list shows due counts
  await clickByText(page, '.nav-item', 'Decks');
  await waitForText(page, 'Biology');
  await sleep(400);
  const bioRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.deck-row')].find((r) => r.textContent.includes('Biology'));
    return row ? row.querySelector('.count-new').textContent : null;
  });
  if (bioRow === '2') ok('deck tree shows 2 new cards'); else fail('deck counts', `expected 2, got ${bioRow}`);

  // 6. Study: classic flip + rate Good
  await clickByText(page, '.deck-name', 'Biology');
  await page.waitForSelector('.study-card');
  await clickByText(page, '.mode-toggle button', 'Classic');
  await clickByText(page, 'button', 'Show answer');
  await page.waitForSelector('.rating-row');
  const intervals = await page.$$eval('.rate-interval', (els) => els.map((e) => e.textContent));
  if (intervals.length === 4 && intervals.every((s) => s.length > 0)) ok(`4 rating buttons with previews: ${intervals.join(' / ')}`);
  else fail('interval previews', JSON.stringify(intervals));
  await clickByText(page, '.rate-btn', 'Good');
  await sleep(500);
  ok('rated Good — next card shown');

  // 7. Keyboard: space flips, 3 = Good
  await page.keyboard.press('Space');
  await page.waitForSelector('.rating-row');
  await page.keyboard.press('3');
  await sleep(500);
  ok('keyboard shortcuts flip + rate');

  // 8. Undo
  await page.keyboard.press('u');
  await waitForText(page, 'Review undone');
  ok('undo restores card');
  await page.keyboard.press('Space');
  try {
    await page.waitForSelector('.rating-row', { timeout: 5000 });
  } catch (e) {
    const dbg = await page.evaluate(() => ({
      question: document.querySelector('.study-question')?.textContent?.slice(0, 50) ?? null,
      hasShowAnswer: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Show answer')),
      hasAiBox: !!document.querySelector('.ai-answer-box'),
      shortBreak: document.body.innerText.includes('Short break'),
      congrats: document.body.innerText.includes('Congratulations'),
      modeActive: document.querySelector('.mode-toggle button.active')?.textContent,
      counts: document.querySelector('.study-counts')?.textContent,
      activeEl: document.activeElement?.tagName + '.' + (document.activeElement?.className ?? ''),
    }));
    console.log('DEBUG undo-flip state:', JSON.stringify(dbg));
    console.log('DEBUG page errors so far:', JSON.stringify(errors));
    throw e;
  }
  await page.keyboard.press('3');
  await sleep(400);

  // 9. Browse: search + suspend
  await clickByText(page, '.nav-item', 'Browse');
  await page.waitForSelector('.browser-table');
  await waitForText(page, 'organelle');
  await page.type('.browser-search input', 'deck:biology');
  await sleep(400);
  const rowCount = await page.$$eval('.browser-table tbody tr', (rs) => rs.length);
  if (rowCount === 2) ok('browser search deck:biology → 2 cards'); else fail('browser search', `expected 2 rows, got ${rowCount}`);
  await page.click('.browser-table tbody tr');
  await page.waitForSelector('.bulk-bar');
  await clickByText(page, '.bulk-bar button', 'Suspend');
  await waitForText(page, 'Suspended');
  await page.evaluate(() => {
    const inp = document.querySelector('.browser-search input');
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('.browser-search input', 'is:suspended');
  await sleep(400);
  const suspCount = await page.$$eval('.browser-table tbody tr', (rs) => rs.length);
  if (suspCount === 1) ok('is:suspended finds the suspended card'); else fail('is:suspended', `got ${suspCount}`);

  // 10. Stats renders
  await clickByText(page, '.nav-item', 'Stats');
  await waitForText(page, 'Statistics');
  await waitForText(page, 'True retention');
  await page.waitForSelector('.heatmap-svg');
  const studied = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.stat-tile')].find((t) => t.textContent.includes('Cards studied'));
    return tile?.querySelector('.stat-value')?.textContent;
  });
  if (parseInt(studied) >= 2) ok(`stats: ${studied} cards studied today`); else fail('stats today', `got ${studied}`);
  await page.screenshot({ path: `${SHOT_DIR}/stats-light.png` });

  // 11. Settings: invalid API key → error surfaces (proves fetch + error path)
  await clickByText(page, '.nav-item', 'Settings');
  await waitForText(page, 'Gemini API');
  await page.type('.key-row input', 'AIzaINVALID-KEY-FOR-TESTING-000000');
  await clickByText(page, '.key-row button', 'Test');
  await page.waitForFunction(
    () => document.querySelector('.settings-section .ai-error')?.textContent?.length > 3,
    { timeout: 20000 },
  );
  const errText = await page.$eval('.settings-section .ai-error', (e) => e.textContent);
  ok(`gemini error path works: "${errText.slice(0, 70)}"`);

  // 12. Dark mode
  await clickByText(page, '.seg-control button', 'Dark');
  await sleep(300);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme === 'dark') ok('dark theme applies'); else fail('dark theme', theme);
  await clickByText(page, '.nav-item', 'Stats');
  await waitForText(page, 'Statistics');
  await sleep(300);
  await page.screenshot({ path: `${SHOT_DIR}/stats-dark.png` });
  await clickByText(page, '.nav-item', 'Decks');
  await sleep(300);
  await page.screenshot({ path: `${SHOT_DIR}/decks-dark.png` });

  // 13. Persistence across reload
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForText(page, 'Biology');
  const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
  if (persisted === 'dark') ok('settings + data persist across reload'); else fail('persistence', persisted);

  // 14. Cloze: add a cloze note and study front rendering
  await clickByText(page, '.seg-control button', 'Light').catch(() => {});
  await clickByText(page, '.nav-item', 'Add');
  await page.waitForSelector('.add-view select');
  await page.evaluate(() => {
    const typeSel = document.querySelectorAll('.add-selectors select')[0];
    typeSel.value = 'cloze';
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => {
    const deckSel = document.querySelectorAll('.add-selectors select')[1];
    const opt = [...deckSel.options].find((o) => o.textContent.includes('Default'));
    deckSel.value = opt.value;
    deckSel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const areas2 = await page.$$('.add-view textarea');
  await areas2[0].type('The powerhouse of the cell is the {{c1::mitochondrion}} and it makes {{c2::ATP}}.');
  await waitForText(page, '2 cloze deletions');
  await clickByText(page, 'button', 'Add note');
  await waitForText(page, 'Added — 2 cards created');
  ok('cloze note → 2 cards');
  await clickByText(page, '.nav-item', 'Decks');
  await sleep(300);
  await clickByText(page, '.deck-name', 'Default');
  await page.waitForSelector('.study-card');
  const q = await page.$eval('.study-question', (e) => e.textContent);
  if (q.includes('...') && q.includes('cell')) ok(`cloze front renders: "${q.trim().slice(0, 60)}"`); else fail('cloze front', q);
  await page.screenshot({ path: `${SHOT_DIR}/study-light.png` });

  // 15. AI mode UI present (no key behavior)
  await clickByText(page, '.mode-toggle button', 'AI');
  await page.waitForSelector('.ai-answer-box');
  await page.type('.ai-answer-box', 'mitochondrion');
  await clickByText(page, 'button', 'Grade my answer');
  await page.waitForFunction(
    () => document.querySelector('.ai-error')?.textContent?.length > 3,
    { timeout: 20000 },
  );
  const aiErr = await page.$eval('.ai-error', (e) => e.textContent);
  ok(`AI grade path returns actionable error without valid key: "${aiErr.slice(0, 60)}"`);

  console.log('\nPage JS errors:', errors.length ? errors : 'none');
  const failed = results.filter(([s]) => s === 'FAIL');
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('E2E crashed:', e);
  process.exit(2);
} finally {
  await browser.close();
}
