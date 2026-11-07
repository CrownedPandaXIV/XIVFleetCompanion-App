// Every look (shared/themes.js, the plugin's too) measured: text and every meaning colour readable on its background
// (WCAG contrast), the meaning colours far enough apart to tell at a glance, and the colour-blind friendly ones still
// apart with each common kind of colour blindness (Machado, Oliveira and Fernandes' simulation, full strength).
const test = require('node:test');
const assert = require('node:assert');
const { THEMES, themeVariables } = require('../shared/themes');

const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function lab(c) {
  const [r, g, b] = c.map(lin);
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => Math.hypot(...lab(rgb(a)).map((v, i) => v - lab(rgb(b))[i]));

// Full-strength simulation matrices (linear RGB).
const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (hex, m) => {
  const v = rgb(hex).map(lin);
  return m.map((row) => Math.min(255, Math.max(0, unlin(Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2]))))));
};

const looks = THEMES.filter((t) => t.tokens);

for (const t of looks) {
  const k = t.tokens;
  test(`${t.name}: text is easy to read`, () => {
    assert.ok(contrast(k.text, k.bg) >= 7, `text ${contrast(k.text, k.bg).toFixed(2)}`);
    assert.ok(contrast(k.text, k.panel) >= 7, `text on boxes ${contrast(k.text, k.panel).toFixed(2)}`);
    assert.ok(contrast(k.textSoft, k.bg) >= 4.5, `secondary text ${contrast(k.textSoft, k.bg).toFixed(2)}`);
    assert.ok(contrast(k.dim, k.bg) >= 4.5, `less important text ${contrast(k.dim, k.bg).toFixed(2)}`);
    assert.ok(contrast(k.dim, k.panel) >= 4, `less important text on boxes ${contrast(k.dim, k.panel).toFixed(2)}`);
    assert.ok(contrast(k.link, k.bg) >= 4.5, `links ${contrast(k.link, k.bg).toFixed(2)}`);
    assert.ok(contrast(k.heading || k.text, k.bg) >= 4.5, `headings ${contrast(k.heading || k.text, k.bg).toFixed(2)}`);
  });
  test(`${t.name}: every colour that means something is readable, normal and colour-blind friendly`, () => {
    const colours = { good: k.good, warn: k.warn, danger: k.danger, gil: k.gil, address: k.address, fc: k.fc, fcPoints: k.fcPoints,
      ...Object.fromEntries(Object.entries(k.roles).map(([r, c]) => [`role ${r}`, c])),
      'cb good': k.cb.good, 'cb warn': k.cb.warn, 'cb danger': k.cb.danger };
    for (const [name, c] of Object.entries(colours)) {
      assert.ok(contrast(c, k.bg) >= 4.5, `${name} on the page: ${contrast(c, k.bg).toFixed(2)}`);
      assert.ok(contrast(c, k.panel) >= 4, `${name} on boxes: ${contrast(c, k.panel).toFixed(2)}`);
    }
  });
  test(`${t.name}: fine, a look and urgent are told apart, and the warning never looks like gil`, () => {
    for (const [a, b] of [['good', 'warn'], ['good', 'danger'], ['warn', 'danger']]) {
      assert.ok(deltaE(k[a], k[b]) >= 25, `${a}/${b}: ${deltaE(k[a], k[b]).toFixed(1)}`);
    }
    assert.ok(deltaE(k.warn, k.gil) >= 15, `warning/gil: ${deltaE(k.warn, k.gil).toFixed(1)}`);
    assert.ok(deltaE(k.danger, k.accent) >= 20, `urgent/the look's own colour: ${deltaE(k.danger, k.accent).toFixed(1)}`);
  });
  test(`${t.name}: colour-blind friendly colours stay apart with every common kind of colour blindness`, () => {
    for (const [kind, m] of Object.entries(CVD)) {
      const s = Object.fromEntries(['good', 'warn', 'danger'].map((x) => [x, simulate(k.cb[x], m)]));
      for (const [a, b] of [['good', 'warn'], ['good', 'danger'], ['warn', 'danger']]) {
        const d = Math.hypot(...lab(s[a]).map((v, i) => v - lab(s[b])[i]));
        assert.ok(d >= 20, `${kind} ${a}/${b}: ${d.toFixed(1)}`);
      }
    }
  });
}

test('every look has every colour, and colour-blind friendly turns the colours that only say what a thing is plain', () => {
  const keys = Object.keys(themeVariables('fleet', false)).sort();
  for (const t of looks) {
    assert.deepStrictEqual(Object.keys(themeVariables(t.key, false)).sort(), keys, t.name);
    const cb = themeVariables(t.key, true);
    assert.strictEqual(cb['--good'], t.tokens.cb.good);
    assert.strictEqual(cb['--gil'], t.tokens.text);
    assert.strictEqual(cb['--role-tank'], t.tokens.text);
  }
  assert.strictEqual(themeVariables('nonsense', false)['--bg'], '#12141a', 'an unknown look is the default');
});
