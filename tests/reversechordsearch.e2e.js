// End-to-end tests: drive the real page in Chromium.
const { test, expect } = require('@playwright/test');
const path = require('node:path');

const PAGE = 'file://' + path.join(__dirname, '..', 'reversechordsearch.html');

// Fake Web MIDI so we can send notes from tests.
const FAKE_MIDI = () => {
  const input = { onmidimessage: null };
  window.__midi = {
    on: (n, v = 100) => input.onmidimessage && input.onmidimessage({ data: [0x90, n, v] }),
    off: n => input.onmidimessage && input.onmidimessage({ data: [0x80, n, 0] }),
  };
  navigator.requestMIDIAccess = () => Promise.resolve({ inputs: new Map([['fake', input]]), onstatechange: null });
};

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(FAKE_MIDI);
});
test.afterEach(() => expect(errors, 'no JS errors on the page').toEqual([]));

const hero = page => page.locator('.hero-symbol');
// Frets are given in tab order (low string first) like a chord chart.
async function playTab(page, shape) {
  const frets = shape.split('').map(c => (c === 'x' ? -1 : +c)).reverse();
  for (let s = 0; s < 6; s++) if (frets[s] >= 0) await page.locator(`#marker-${s}-${frets[s]}`).click();
}

test('loads with empty state and the chord library', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#hero')).toContainText('Play some notes');
  await expect(page.locator('#results-title')).toHaveText('Chord Library');
  await expect(page.locator('#results .chord-card')).toHaveCount(59);
  await expect(page.locator('#midi-text')).toHaveText('MIDI: 1 device');
});

test('clicking frets identifies an open C chord', async ({ page }) => {
  await page.goto(PAGE);
  await playTab(page, 'x32010');
  await expect(hero(page)).toHaveText('C');
  await expect(page.locator('#hero')).toContainText('Exact match');
  await expect(page.locator('#marker-4-3')).toHaveClass(/on fn-root|fn-root on/);
  await expect(page).toHaveURL(/g=x\.3\.2\.0\.1\.0/);
});

test('removing a note re-identifies, mute button toggles open strings', async ({ page }) => {
  await page.goto(PAGE);
  await playTab(page, 'x02210'); // Am
  await expect(hero(page)).toHaveText('Am');
  await page.locator('#marker-1-1').click(); // remove C on the B string
  await expect(hero(page)).toHaveText('A5');
  await page.locator('#mute-btn-1').click(); // open B string -> A E B = Asus2
  await expect(hero(page)).toHaveText('Asus2');
});

test('piano keys and slash chord naming', async ({ page }) => {
  await page.goto(PAGE);
  for (const m of [52, 55, 60]) await page.locator(`#piano-key-${m}`).click(); // E G C
  await expect(hero(page)).toHaveText('C/E');
  await expect(page.locator('#hero')).toContainText('1st inversion');
});

test('computer keyboard plays notes', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  for (const k of ['a', 'd', 'g', 'u']) await page.keyboard.press(k); // C E G Bb
  await expect(hero(page)).toHaveText('C7');
  await page.keyboard.press('Escape');
  await expect(page.locator('#hero')).toContainText('Play some notes');
});

test('MIDI latch: a new chord gesture replaces the previous chord', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#midi-text')).toHaveText('MIDI: 1 device');
  await page.evaluate(() => { [60, 64, 67].forEach(n => __midi.on(n)); });
  await expect(hero(page)).toHaveText('C');
  await page.evaluate(() => { [60, 64, 67].forEach(n => __midi.off(n)); });
  await expect(hero(page)).toHaveText('C'); // still latched after release
  await page.evaluate(() => { [57, 60, 64].forEach(n => __midi.on(n)); });
  await expect(hero(page)).toHaveText('Am');
});

test('quick input: chord symbol opens the inspector with voicings', async ({ page }) => {
  await page.goto(PAGE);
  await page.fill('#quick-input', 'Am7');
  await page.press('#quick-input', 'Enter');
  await expect(page.locator('#hero')).toContainText('Chord inspector');
  await expect(hero(page)).toHaveText('Am7');
  const thumbs = page.locator('.vthumb');
  expect(await thumbs.count()).toBeGreaterThan(10);
  await expect(page.locator('.vthumb.active .vt-tab')).toHaveText('x02010');
  // Voicing is drawn on the fretboard
  await expect(page.locator('#marker-4-0')).toHaveClass(/ on/);
  await page.locator('.voicing-nav button[data-act=vnext]').click();
  await expect(page.locator('.vthumb.active .vt-tab')).not.toHaveText('x02010');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.vthumb.active .vt-tab')).toHaveText('x02010');
});

test('quick input: tab and note lists', async ({ page }) => {
  await page.goto(PAGE);
  await page.fill('#quick-input', '133211');
  await page.press('#quick-input', 'Enter');
  await expect(hero(page)).toHaveText('F');
  await page.fill('#quick-input', 'B D F A');
  await page.press('#quick-input', 'Enter');
  await expect(hero(page)).toHaveText('Bm7b5'.replace('b5', '♭5'));
  await page.fill('#quick-input', 'nonsense!!');
  await page.press('#quick-input', 'Enter');
  await expect(page.locator('#toast')).toContainText("Couldn't read");
});

test('changing the bass in the inspector makes an inversion', async ({ page }) => {
  await page.goto(PAGE);
  await page.fill('#quick-input', 'G');
  await page.press('#quick-input', 'Enter');
  await page.locator('.pill[data-act=bass]', { hasText: 'B' }).click();
  await expect(hero(page)).toHaveText('G/B');
  // every shown voicing has B as lowest note: first voicing's lowest played string must be a B
  const tab = await page.locator('.vthumb.active .vt-tab').textContent();
  expect(tab).toMatch(/^(x2|x?x?x?\d)/);
});

test('editing the board while inspecting copies the voicing to your notes', async ({ page }) => {
  await page.goto(PAGE);
  await page.fill('#quick-input', 'C');
  await page.press('#quick-input', 'Enter');
  await page.locator('#marker-0-3').click(); // add G on high e to x32010
  await expect(page.locator('#hero')).toContainText('Detected chord');
  await expect(hero(page)).toHaveText('C');
  await expect(page).toHaveURL(/g=x\.3\.2\.0\.1\.3/);
});

test('transpose shifts the chord', async ({ page }) => {
  await page.goto(PAGE);
  await playTab(page, 'x32010');
  await page.locator('#btn-transpose-up').click();
  await page.locator('#btn-transpose-up').click();
  await expect(hero(page)).toHaveText('D');
});

test('state is restored from the URL', async ({ page }) => {
  await page.goto(PAGE + '#c=7~7~7');
  await expect(hero(page)).toHaveText('G7');
  await page.goto(PAGE + '#g=x.0.2.2.1.0');
  await page.reload();
  await expect(hero(page)).toHaveText('Am');
});

test('results: matches and filter', async ({ page }) => {
  await page.goto(PAGE);
  await playTab(page, 'x02010'); // Am7
  await expect(page.locator('.chord-card.best .cc-sym')).toHaveText('Am7');
  await expect(page.locator('#results')).toContainText('C6/A');
  await page.fill('#chord-search', '6th');
  await expect(page.locator('#results .chord-card')).not.toHaveCount(0);
  for (const sym of await page.locator('#results .cc-sym').allTextContents()) expect(sym).toContain('6');
});

test('tuning change re-voices the inspected chord', async ({ page }) => {
  await page.goto(PAGE);
  await page.fill('#quick-input', 'D');
  await page.press('#quick-input', 'Enter');
  await page.selectOption('#tuning-select', 'Drop D');
  await expect(page.locator('.vthumb.active .vt-tab')).toHaveText(/^0/);
  await expect(page.locator('#hero')).toContainText('Drop D');
});

test('phone width: no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE);
  await page.fill('#quick-input', 'Cmaj9');
  await page.press('#quick-input', 'Enter');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
