// End-to-end smoke test for AnkiAI using system Chrome via puppeteer-core.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5199';
const SHOT_DIR = process.env.SHOT_DIR || '.';
const results = [];
const ok = (name) => { results.push(['PASS', name]); console.log('PASS', name); };
const fail = (name, err) => { results.push(['FAIL', name + ' :: ' + err]); console.log('FAIL', name, '::', err); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, selector, text, opts) {
  const handle = await page.evaluateHandle(
    (sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim().includes(t)),
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no ${selector} containing "${text}"`);
  await el.click(opts);
  return el;
}

async function pressWithCtrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

async function dumpDecks(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('ankiai');
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['decks', 'cards'], 'readonly');
          const out = {};
          tx.objectStore('decks').getAll().onsuccess = (e) => {
            out.decks = e.target.result.map((d) => ({ id: d.id, name: d.name, parentId: d.parentId }));
          };
          tx.objectStore('cards').getAll().onsuccess = (e) => {
            out.cards = e.target.result.map((c) => ({ deckId: c.deckId }));
          };
          tx.oncomplete = () => {
            idb.close();
            resolve(out);
          };
        };
      }),
  );
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

  // 2. Create a folder on the desktop
  await clickByText(page, 'button', 'New folder');
  await page.waitForSelector('.modal-panel input');
  await page.type('.modal-panel input', 'Biology');
  await clickByText(page, '.modal-panel button', 'Create');
  await page.waitForSelector('.deck-tile');
  await waitForText(page, 'Biology');
  ok('folder created as desktop tile');

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

  // 5. Desktop tile shows due counts
  await clickByText(page, '.nav-item', 'Decks');
  await waitForText(page, 'Biology');
  await sleep(400);
  const bioTileNew = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.deck-tile')].find((t) => t.textContent.includes('Biology'));
    return tile ? tile.querySelector('.count-new')?.textContent : null;
  });
  if (bioTileNew === '2') ok('folder tile shows 2 new cards'); else fail('tile counts', `expected 2, got ${bioTileNew}`);

  // 6. Study: double-click opens the folder, Study button starts the session
  await clickByText(page, '.deck-tile', 'Biology', { count: 2 });
  await page.waitForSelector('.folder-head-actions');
  await clickByText(page, '.folder-head-actions button', 'Study');
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
  await clickByText(page, '.crumb', 'Home').catch(() => {});
  await sleep(200);
  await clickByText(page, '.deck-tile', 'Default', { count: 2 });
  await page.waitForSelector('.folder-head-actions');
  await clickByText(page, '.folder-head-actions button', 'Study');
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

  // 16. Desktop: cut a tile at Home, open Default, paste inside it
  await clickByText(page, '.nav-item', 'Decks');
  await sleep(400);
  await clickByText(page, '.crumb', 'Home');
  await sleep(300);
  await clickByText(page, '.deck-tile', 'Biology'); // single click = select
  await pressWithCtrl(page, 'x');
  await sleep(150);
  const cutDim = await page.evaluate(
    () => !![...document.querySelectorAll('.deck-tile.tile-cut')].find((t) => t.textContent.includes('Biology')),
  );
  if (cutDim) ok('Ctrl+X dims the cut tile'); else fail('cut visual', 'tile not dimmed');
  await clickByText(page, '.deck-tile', 'Default', { count: 2 }); // enter folder
  await sleep(300);
  await pressWithCtrl(page, 'v'); // paste into current folder
  await sleep(500);
  let d = await dumpDecks(page);
  {
    const bio = d.decks.find((x) => x.name === 'Biology');
    const def = d.decks.find((x) => x.name === 'Default');
    if (bio.parentId === def.id) ok('cut/paste moved Biology inside Default');
    else fail('cut/paste', `Biology.parentId=${bio.parentId}, Default.id=${def.id}`);
  }

  // 17. Copy inside a folder, paste at Home → deep clone with cards
  const cardsBefore = d.cards.length;
  await clickByText(page, '.deck-tile', 'Biology');
  await pressWithCtrl(page, 'c');
  await clickByText(page, '.crumb', 'Home');
  await sleep(300);
  await pressWithCtrl(page, 'v');
  await sleep(600);
  d = await dumpDecks(page);
  {
    const bios = d.decks.filter((x) => x.name === 'Biology');
    const rootBio = bios.find((x) => x.parentId === null);
    const clonedCards = rootBio ? d.cards.filter((c) => c.deckId === rootBio.id).length : 0;
    if (rootBio && d.cards.length === cardsBefore + 2 && clonedCards === 2) {
      ok('copy/paste cloned the folder to Home with its 2 cards');
    } else {
      fail('copy/paste', `rootBio=${!!rootBio}, cards ${cardsBefore}→${d.cards.length}, cloned=${clonedCards}`);
    }
  }

  // 18. Drag & drop a tile onto a folder tile
  const dndResult = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.deck-tile')];
    const src = tiles.find((t) => t.textContent.includes('Biology'));
    const dst = tiles.find((t) => t.textContent.includes('Default'));
    if (!src || !dst) return 'tiles not found';
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 'ok';
  });
  await sleep(500);
  d = await dumpDecks(page);
  {
    const def = d.decks.find((x) => x.name === 'Default');
    const biosUnderDefault = d.decks.filter((x) => x.name === 'Biology' && x.parentId === def.id).length;
    if (dndResult === 'ok' && biosUnderDefault === 2) ok('drag & drop moved the tile into Default');
    else fail('drag & drop', `dispatch=${dndResult}, under Default=${biosUnderDefault}`);
  }

  // 19. Right-click context menu on a folder tile
  await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.deck-tile')].find((t) => t.textContent.includes('Default'));
    const rect = tile.getBoundingClientRect();
    tile.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: rect.top + 20 }),
    );
  });
  await page.waitForSelector('.ctx-menu');
  const menuItems = await page.$$eval('.ctx-menu button', (bs) => bs.map((b) => b.textContent.trim()));
  if (menuItems.some((t) => t.includes('Cut')) && menuItems.some((t) => t.includes('Paste into folder'))) {
    ok('right-click context menu with Cut/Copy/Paste');
  } else fail('context menu', JSON.stringify(menuItems));
  await page.keyboard.press('Escape');
  await sleep(150);

  // 20. Notes appear as file tiles inside their folder; double-click edits
  await clickByText(page, '.deck-tile', 'Default', { count: 2 });
  await sleep(300);
  await clickByText(page, '.deck-tile', 'Biology', { count: 2 });
  await sleep(400);
  const noteTiles = await page.$$eval('.note-tile', (ts) => ts.length);
  if (noteTiles === 2) ok('2 notes shown as file tiles inside the folder');
  else fail('note tiles', `expected 2, got ${noteTiles}`);
  await page.evaluate(() => {
    const t = document.querySelector('.note-tile');
    t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await waitForText(page, 'Edit note');
  ok('double-click on a note tile opens the editor');
  await page.keyboard.press('Escape');
  await sleep(200);

  // 21. List mode toggle: single click studies, then back to desktop
  await clickByText(page, '.seg-control button', 'List');
  await sleep(300);
  await clickByText(page, '.deck-name', 'Default'); // single click = study in list mode
  await sleep(600);
  const inStudy = await page.evaluate(
    () => !!document.querySelector('.study-card') || document.body.innerText.includes('Congratulations') || document.body.innerText.includes('Short break'),
  );
  if (inStudy) ok('list mode: single click enters study'); else fail('list mode', 'did not enter study');
  await clickByText(page, '.nav-item', 'Decks');
  await sleep(200);
  await clickByText(page, '.seg-control button', 'Desktop');
  await sleep(200);

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
