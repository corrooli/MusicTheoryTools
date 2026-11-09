const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');

const E = loadEngine();
const STANDARD = [64, 59, 55, 50, 45, 40]; // index 0 = high e
const DROP_D = [64, 59, 55, 50, 45, 38];

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pc = n => { let p = PC[n[0]]; for (const c of n.slice(1)) p += c === '#' ? 1 : -1; return (p + 12) % 12; };
// VM-realm arrays have a different prototype; copy into this realm before deep-comparing.
const arr = a => Array.from(a);

/** Identify notes given lowest-first; returns the best symbol. */
function best(notes) {
  const res = E.identify(new Set(notes.map(pc)), pc(notes[0]));
  const r = res[0];
  return { ...r, symbol: E.chordInfo(r.root, r.qi, r.bass).symbol };
}
function symbols(notes, n = 5) {
  return E.identify(new Set(notes.map(pc)), pc(notes[0])).slice(0, n)
    .map(r => E.chordInfo(r.root, r.qi, r.bass).symbol);
}
const tab = f => [...f].reverse().map(x => (x < 0 ? 'x' : x)).join(f.some(x => x > 9) ? '-' : '');
function voicings(symbol, tuning = STANDARD, frets = 12) {
  const c = E.parseChordSymbol(symbol);
  assert.ok(c, `could not parse ${symbol}`);
  return E.findVoicings(c.root, c.qi, c.bass, tuning, frets);
}

test('chord dictionary is well formed', () => {
  const syms = new Set();
  for (const q of E.Q) {
    assert.ok(!syms.has(q.sym), `duplicate symbol ${q.sym}`);
    syms.add(q.sym);
    assert.equal(q.tones[0].label, '1', `${q.sym} must start with the root`);
    const pcs = q.tones.map(t => t.semi % 12);
    assert.equal(new Set(pcs).size, pcs.length, `${q.sym} has duplicate pitch classes`);
    assert.ok(q.tones.some(t => !t.opt && t.label !== '1'), `${q.sym} needs a required non-root tone`);
  }
});

test('no two chord types share the same required + optional tone set', () => {
  const seen = new Map();
  for (const q of E.Q) {
    const key = q.tones.map(t => `${t.semi % 12}${t.opt ? '?' : ''}`).sort().join(',');
    assert.ok(!seen.has(key), `${q.sym} duplicates ${seen.get(key)}`);
    seen.set(key, q.sym);
  }
});

test('identifies common chords in root position', () => {
  const cases = [
    [['C', 'E', 'G'], 'C'],
    [['A', 'C', 'E'], 'Am'],
    [['B', 'D', 'F'], 'Bdim'],
    [['C', 'E', 'G#'], 'Caug'],
    [['D', 'E', 'A'], 'Dsus2'],
    [['D', 'G', 'A'], 'Dsus4'],
    [['E', 'B'], 'E5'],
    [['G', 'B', 'D', 'F'], 'G7'],
    [['C', 'E', 'G', 'B'], 'Cmaj7'],
    [['A', 'C', 'E', 'G'], 'Am7'],
    [['B', 'D', 'F', 'A'], 'Bm7b5'],
    [['C', 'Eb', 'Gb', 'A'], 'Cdim7'],
    [['C', 'Eb', 'G', 'B'], 'Cm(maj7)'],
    [['C', 'E', 'G', 'A'], 'C6'],
    [['C', 'E', 'G', 'D'], 'Cadd9'],
    [['C', 'E', 'G', 'B', 'D'], 'Cmaj9'],
    [['G', 'B', 'D', 'F', 'A#'], 'G7#9'],
    [['E', 'G#', 'B', 'D', 'F'], 'E7b9'],
    [['F#', 'A#', 'C#', 'E', 'G#', 'D#'], 'F#13'],
    [['C', 'E', 'G', 'A', 'D'], 'C6/9'],
  ];
  for (const [notes, want] of cases) {
    const b = best(notes);
    assert.equal(b.symbol, want, `${notes.join(' ')}`);
    assert.equal(b.type, 'exact', `${notes.join(' ')} should be exact`);
  }
});

test('the 5th is optional where musicians drop it', () => {
  assert.equal(best(['C', 'E', 'Bb']).symbol, 'C7');
  assert.equal(best(['C', 'E', 'Bb']).type, 'exact');
  assert.equal(best(['A', 'C', 'G']).symbol, 'Am7');
  assert.equal(best(['F', 'A', 'E']).symbol, 'Fmaj7');
});

test('bass note decides between rotations of the same notes', () => {
  assert.equal(best(['C', 'E', 'G', 'A']).symbol, 'C6');
  assert.equal(best(['A', 'C', 'E', 'G']).symbol, 'Am7');
  assert.equal(best(['E', 'G', 'C']).symbol, 'C/E');
  assert.equal(best(['G', 'C', 'E']).symbol, 'C/G');
  assert.equal(best(['F#', 'D', 'A']).symbol, 'D/F#');
});

test('inversions are named', () => {
  const c = E.parseChordSymbol('C/E');
  assert.equal(E.chordInfo(c.root, c.qi, c.bass).inv, '1st inversion');
  const g = E.parseChordSymbol('C/G');
  assert.equal(E.chordInfo(g.root, g.qi, g.bass).inv, '2nd inversion');
  const b = E.parseChordSymbol('C7/Bb');
  assert.equal(E.chordInfo(b.root, b.qi, b.bass).inv, '3rd inversion');
});

test('slash chords with a non-chord-tone bass are offered', () => {
  // D bass under a C triad
  assert.ok(symbols(['D', 'C', 'E', 'G'], 6).includes('C/D'));
  const r = E.identify(new Set(['D', 'C', 'E', 'G'].map(pc)), pc('D')).find(x => E.chordInfo(x.root, x.qi, x.bass).symbol === 'C/D');
  assert.equal(r.type, 'slash');
});

test('incomplete input yields partial matches with missing tones', () => {
  const b = best(['C', 'E']);
  assert.equal(b.symbol, 'C');
  assert.equal(b.type, 'partial');
  assert.deepEqual(arr(b.missReq), ['5']);
});

test('every played note is always accounted for', () => {
  // Fuzz: random note sets must never produce a match that ignores a played note
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const n = 2 + Math.floor(rnd() * 4);
    const pcs = new Set();
    while (pcs.size < n) pcs.add(Math.floor(rnd() * 12));
    const bass = [...pcs][0];
    for (const r of E.identify(pcs, bass)) {
      const info = E.chordInfo(r.root, r.qi, r.bass);
      for (const p of pcs) assert.ok(info.pcs.has(p), `${info.symbol} misses pc ${p}`);
      assert.equal(r.bass, bass);
    }
  }
});

test('notes are spelled by letter, not by lookup table', () => {
  const spell = s => { const c = E.parseChordSymbol(s); return E.chordInfo(c.root, c.qi, c.bass, c.pref).tones.map(t => t.note).join(' '); };
  assert.equal(spell('Ebm'), 'Eb Gb Bb');
  assert.equal(spell('F#7'), 'F# A# C# E');
  assert.equal(spell('Bbmaj7'), 'Bb D F A');
  assert.equal(spell('Cdim7'), 'C Eb Gb Bbb');
  assert.equal(spell('C#m7b5'), 'C# E G B');
  assert.equal(spell('Gbmaj7'), 'Gb Bb Db F');
  assert.equal(spell('Abm'), 'Ab Cb Eb');
  assert.equal(spell('E7b9b13'), 'E G# B D F C');
});

test('root spelling follows convention when none is given', () => {
  const sym = (root, s) => E.chordInfo(root, E.Q.find(q => q.sym === s).i).symbol;
  assert.equal(sym(1, ''), 'Db');
  assert.equal(sym(1, 'm'), 'C#m');
  assert.equal(sym(8, ''), 'Ab');
  assert.equal(sym(8, 'm'), 'G#m');
  assert.equal(sym(6, ''), 'F#');
  assert.equal(sym(10, 'm7'), 'Bbm7');
});

test('slash bass never shows double accidentals', () => {
  const dim7 = E.Q.find(q => q.sym === 'dim7').i;
  assert.equal(E.chordInfo(3, dim7, 0).symbol, 'Ebdim7/C');
});

test('parses chord symbols and common aliases', () => {
  const cases = {
    'C': 'C', 'Cmaj': 'C', 'CM7': 'Cmaj7', 'CΔ7': 'Cmaj7', 'C-7': 'Cm7', 'Cmin7': 'Cm7', 'Cø': 'Cm7b5',
    'C°7': 'Cdim7', 'C+': 'Caug', 'Csus': 'Csus4', 'C69': 'C6/9', 'CmM7': 'Cm(maj7)', 'G7(b9)': 'G7b9',
    'Fadd2': 'Fadd9', 'Bb13': 'Bb13', 'Am(add9)': 'Am(add9)', 'D/F#': 'D/F#', 'Eb6/9': 'Eb6/9', 'F♯m7♭5': 'F#m7b5',
  };
  for (const [input, want] of Object.entries(cases)) {
    const c = E.parseChordSymbol(input);
    assert.ok(c, `failed to parse ${input}`);
    assert.equal(E.chordInfo(c.root, c.qi, c.bass, c.pref).symbol, want, input);
  }
  for (const bad of ['xyz', 'Cfoo', 'H7', '']) assert.equal(E.parseChordSymbol(bad), null, bad);
});

test('parses note lists and guitar tab', () => {
  assert.deepEqual(arr(E.parseNoteList('C E G Bb')), [48, 52, 55, 58]);
  assert.deepEqual(arr(E.parseNoteList('C4, E4, G4')), [60, 64, 67]);
  assert.deepEqual(arr(E.parseNoteList('G B D')), [55, 59, 62]);
  assert.equal(E.parseNoteList('C'), null);
  assert.equal(E.parseNoteList('C X'), null);
  assert.deepEqual(arr(E.parseTab('x32010')), [0, 1, 0, 2, 3, -1]);
  assert.deepEqual(arr(E.parseTab('x-3-2-0-1-0')), [0, 1, 0, 2, 3, -1]);
  assert.deepEqual(arr(E.parseTab('8 10 10 9 8 8')), [8, 8, 9, 10, 10, 8]);
  assert.equal(E.parseTab('x3201'), null);
});

test('voicings are valid: right notes, right bass, playable', () => {
  for (const s of ['C', 'G', 'Am', 'F', 'Bm', 'D/F#', 'Cmaj7', 'E7#9', 'F#m7b5', 'G13', 'Bb', 'C/D', 'A5', 'Ebmaj9']) {
    const c = E.parseChordSymbol(s);
    const info = E.chordInfo(c.root, c.qi, c.bass);
    const list = voicings(s);
    assert.ok(list.length > 0, `${s} has no voicings`);
    const required = info.tones.filter(t => !t.opt).map(t => t.pc);
    for (const v of list) {
      const sounding = v.frets.map((f, i) => (f >= 0 ? STANDARD[i] + f : null)).filter(x => x !== null);
      assert.equal(Math.min(...sounding) % 12, info.bass, `${s} ${tab(v.frets)} wrong bass`);
      const hit = new Set(sounding.map(m => m % 12));
      for (const p of hit) assert.ok(info.pcs.has(p), `${s} ${tab(v.frets)} has a foreign note`);
      for (const p of required) assert.ok(hit.has(p), `${s} ${tab(v.frets)} misses a required tone`);
      const fretted = v.frets.filter(f => f > 0);
      if (fretted.length) assert.ok(Math.max(...fretted) - Math.min(...fretted) <= 3, `${s} ${tab(v.frets)} stretch too wide`);
    }
    assert.equal(new Set(list.map(v => v.frets.join())).size, list.length, `${s} has duplicate voicings`);
  }
});

test('classic chord-book shapes rank near the top', () => {
  const expectTop = (sym, shape, n) => {
    const rank = voicings(sym).map(v => tab(v.frets)).indexOf(shape);
    assert.ok(rank >= 0 && rank < n, `${sym} ${shape} ranked ${rank + 1}, expected top ${n}`);
  };
  expectTop('C', 'x32010', 1);
  expectTop('G', '320003', 1);
  expectTop('Am', 'x02210', 1);
  expectTop('E', '022100', 1);
  expectTop('D', 'xx0232', 1);
  expectTop('F', '133211', 1);
  expectTop('Am7', 'x02010', 1);
  expectTop('Cmaj7', 'x32000', 1);
  expectTop('Dm', 'xx0231', 2);
  expectTop('Bm', 'x24432', 3);
  expectTop('C', 'x35553', 5);
  expectTop('A7', '575655', 5);
  expectTop('E7#9', 'x7678x', 25);
});

test('voicings respect tuning and fret limit', () => {
  for (const v of voicings('D', DROP_D)) {
    const sounding = v.frets.map((f, i) => (f >= 0 ? DROP_D[i] + f : null)).filter(x => x !== null);
    assert.equal(Math.min(...sounding) % 12, pc('D'));
  }
  assert.equal(tab(voicings('D', DROP_D)[0].frets).slice(0, 1), '0', 'Drop D should use the low open D');
  for (const v of voicings('C', STANDARD, 5)) assert.ok(Math.max(...v.frets) <= 5);
});

test('piano voicing is close position with the requested bass lowest', () => {
  const c = E.parseChordSymbol('C9/E');
  const notes = E.pianoVoicing(c.root, c.qi, c.bass);
  assert.equal(notes[0] % 12, pc('E'));
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i] > notes[i - 1]);
  assert.equal(new Set(notes.map(n => n % 12)).size, notes.length);
});
