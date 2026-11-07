// The looks (Settings → General → Look), shared with the plugin: the plugin's Theme.cs has the same colours, and its
// tests check them against this file (tests/themes-fixture.js writes them out). Each look gives the window's colours
// and the colours that mean something; tests/themes.test.js measures every look's contrast and checks its
// colour-blind friendly status colours stay apart for every common kind of colour blindness.
//
// Tokens: bg (the page), sidebar, panel (boxes, inputs, table headers), modal (pop-up windows), hover, hoverStrong,
// border, borderStrong, text, textBright (big numbers), textSoft (secondary text), dim (less important), faint (barely
// there), accent (selection, focus, the active page), accentStrong, link, rowAlt (every other row's tint, with its
// alpha), check (tick marks), headerAlpha (how strong a selected row is), light (a light look), heading (headings;
// the text colour when not given), glow (the selected page glows in the sidebar).
// Meaning: good, warn, danger; what a thing is: gil, address, fc, fcPoints, roles. cb: the colour-blind friendly
// good / warn / danger for this look (from the Okabe–Ito palette, shaded for its background).
(function (root) {
  const ROLES = { tank: '#5b8def', tankBase: '#a3bff5', healer: '#5fb870', healerBase: '#a6d9af', dps: '#e06464', dpsBase: '#efa6a6' };
  const CB_DARK = { good: '#56b4e9', warn: '#f0e442', danger: '#ff7a3d' };

  const THEMES = [
    {
      key: 'fleet', name: 'XIV Fleet Companion', about: 'The app\'s colors: dark blue-grey with blue and amber.',
      tokens: {
        bg: '#12141a', sidebar: '#0d0f13', panel: '#1a1d24', modal: '#181b21', hover: '#23262e', hoverStrong: '#2f3440',
        border: '#2a2e38', borderStrong: '#3a3f4a', text: '#e6e6e6', textBright: '#ffffff', textSoft: '#c0c4cc', dim: '#8a8f9a',
        faint: '#565b66', accent: '#5b8def', accentStrong: '#3987e5', link: '#7aa7e0', rowAlt: ['#ffffff', 0.055], check: '#5b8def',
        headerAlpha: 0.28, light: false,
        good: '#6fbf82', warn: '#e8a04c', danger: '#e57373', gil: '#f2d06b', address: '#8cc4f2', fc: '#b8a6f0', fcPoints: '#5fd3c8',
        roles: ROLES, cb: CB_DARK,
      },
    },
    {
      // Plugin only: Dalamud's own style (the app has no Dalamud to follow).
      key: 'dalamud', name: 'Dalamud', about: 'Like your other plugins (Dalamud\'s own style).', pluginOnly: true,
      tokens: null,
    },
    {
      key: 'highContrast', name: 'High contrast', about: 'Black and white with strong borders.',
      tokens: {
        bg: '#000000', sidebar: '#0a0a0a', panel: '#1e1e1e', modal: '#000000', hover: '#333333', hoverStrong: '#3d3d3d',
        border: '#b3b3b3', borderStrong: '#ffffff', text: '#ffffff', textBright: '#ffffff', textSoft: '#e6e6e6', dim: '#c8c8c8',
        faint: '#8c8c8c', accent: '#0060df', accentStrong: '#0050c0', link: '#7fd4ff', rowAlt: ['#ffffff', 0.10], check: '#ffffff',
        headerAlpha: 1, light: false,
        good: '#3dff8a', warn: '#ff9f1a', danger: '#ff4d4d', gil: '#ffe066', address: '#7fd4ff', fc: '#d0bcff', fcPoints: '#6ff0e2',
        roles: { tank: '#6fa8ff', tankBase: '#b5d2ff', healer: '#5ce68a', healerBase: '#adf2c4', dps: '#ff6b6b', dpsBase: '#ffb3b3' },
        cb: { good: '#56b4e9', warn: '#f0e442', danger: '#ff7a3d' },
      },
    },
    {
      key: 'princess', name: 'Princess', about: 'Neon and pastel pink on deep plum. Very princessy.',
      tokens: {
        bg: '#1c0b1a', sidebar: '#140713', panel: '#2a1027', modal: '#231021', hover: '#3a1636', hoverStrong: '#4d1d47',
        border: '#5c2152', borderStrong: '#8a3279', text: '#ffd6ec', textBright: '#ffffff', textSoft: '#f5b8da', dim: '#c79ab9',
        faint: '#7d5170', accent: '#ff4fb8', accentStrong: '#ff2da6', link: '#ff8fd0', rowAlt: ['#ff4fb8', 0.06], check: '#ff4fb8',
        headerAlpha: 0.30, light: false, heading: '#ff8fd0', glow: true,
        // "Urgent" is a coral red, well away from the pinks, so pink never reads as a warning.
        good: '#7ee8b0', warn: '#ffb547', danger: '#ff5f45', gil: '#ffe27a', address: '#9fd4ff', fc: '#d9b8ff', fcPoints: '#7df0e0',
        roles: { tank: '#7fa8ff', tankBase: '#b9ceff', healer: '#6fdb96', healerBase: '#b2eec7', dps: '#ff6f6f', dpsBase: '#ffb0b0' },
        cb: { good: '#6cc4f0', warn: '#f5e85a', danger: '#ff8a4c' },
      },
    },
    {
      key: 'deepSea', name: 'Deep Sea', about: 'Dark navy and teal with glowing cyan, like the creatures down deep.',
      tokens: {
        bg: '#07141c', sidebar: '#040d13', panel: '#0c2230', modal: '#0a1c28', hover: '#113044', hoverStrong: '#173d55',
        border: '#1a4258', borderStrong: '#2a5f7a', text: '#d8f1f5', textBright: '#ffffff', textSoft: '#b2d6de', dim: '#7fa3ae',
        faint: '#456673', accent: '#2ed3e0', accentStrong: '#1fb5c2', link: '#6fe3ec', rowAlt: ['#2ed3e0', 0.05], check: '#2ed3e0',
        headerAlpha: 0.26, light: false,
        good: '#5fe0a0', warn: '#f2a65a', danger: '#ff6b6b', gil: '#f2d06b', address: '#9dbeff', fc: '#c3a8f5', fcPoints: '#7ff0d4',
        roles: ROLES, cb: CB_DARK,
      },
    },
    {
      key: 'sunset', name: 'Sunset Harbor', about: 'Dusky purple with warm rose-gold, like evening at the docks.',
      tokens: {
        bg: '#1e1424', sidebar: '#160e1b', panel: '#2b1c33', modal: '#25182c', hover: '#3a2643', hoverStrong: '#4a3155',
        border: '#4f3459', borderStrong: '#6e4a7a', text: '#f6e6da', textBright: '#ffffff', textSoft: '#e0c9bd', dim: '#a895a6',
        faint: '#6a5670', accent: '#e8917a', accentStrong: '#d9765c', link: '#f2b29f', rowAlt: ['#e8917a', 0.06], check: '#e8917a',
        headerAlpha: 0.28, light: false,
        good: '#7fd99a', warn: '#ffb04a', danger: '#ff5470', gil: '#ffd866', address: '#9cc8f0', fc: '#d1b3f5', fcPoints: '#6fd8cb',
        roles: ROLES, cb: CB_DARK,
      },
    },
    {
      key: 'parchment', name: 'Parchment', about: 'A light look: cream with dark brown text and ink blue, for daylight.',
      tokens: {
        bg: '#f4ecd8', sidebar: '#eae0c8', panel: '#fbf6ea', modal: '#fbf6ea', hover: '#e6dcc2', hoverStrong: '#dccfb0',
        border: '#cbbe9e', borderStrong: '#a8996f', text: '#2b2118', textBright: '#120c06', textSoft: '#4a3d2e', dim: '#6b5e4c',
        faint: '#a3967d', accent: '#2e5a88', accentStrong: '#23476c', link: '#2e5a88', rowAlt: ['#000000', 0.04], check: '#2e5a88',
        headerAlpha: 0.22, light: true,
        good: '#2a6e2e', warn: '#a35400', danger: '#b3261e', gil: '#7d5e00', address: '#1f5f99', fc: '#6b4fa8', fcPoints: '#0c6e65',
        roles: { tank: '#2f5fb3', tankBase: '#45679f', healer: '#245f2e', healerBase: '#477550', dps: '#b33a3a', dpsBase: '#a04e4e' },
        // Bright yellow can't be read on cream: a darker blue, a deep ochre and a raspberry red (dark vermilion and ochre look alike with red-blindness).
        cb: { good: '#005a9e', warn: '#7a6400', danger: '#b0306a' },
      },
    },
    {
      key: 'evergreen', name: 'Evergreen', about: 'Dark forest green and bark brown with soft teal.',
      tokens: {
        bg: '#101a14', sidebar: '#0a120d', panel: '#18261d', modal: '#15211a', hover: '#213326', hoverStrong: '#2a402f',
        border: '#2e4535', borderStrong: '#46624f', text: '#e3ede2', textBright: '#ffffff', textSoft: '#c3d3c4', dim: '#8fa294',
        faint: '#55695a', accent: '#4fa39a', accentStrong: '#3d8a82', link: '#7cc4bb', rowAlt: ['#ffffff', 0.045], check: '#6fc0b6',
        headerAlpha: 0.30, light: false,
        // "Fine" is a brighter mint, so it stands apart from the green background.
        good: '#8be09f', warn: '#f0a050', danger: '#f07070', gil: '#f2d06b', address: '#9cc8f0', fc: '#c3aef0', fcPoints: '#6fd8cb',
        roles: ROLES, cb: CB_DARK,
      },
    },
  ];

  const DEFAULT_THEME = 'fleet';
  const appThemes = () => THEMES.filter((t) => !t.pluginOnly);
  const themeByKey = (key) => appThemes().find((t) => t.key === key) || appThemes().find((t) => t.key === DEFAULT_THEME);

  const rgba = ([hex, alpha]) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  // The CSS variables for a look: --bg, --text, --good, --role-tank, ... With colour-blind friendly colours on, the
  // meaning colours are the look's colour-blind ones, and the colours that only say what a thing is (gil, addresses,
  // Free Companies, FC points, classes) are plain text, as in the plugin.
  function themeVariables(key, colourBlind) {
    const t = themeByKey(key).tokens;
    const vars = {};
    for (const k of ['bg', 'sidebar', 'panel', 'modal', 'hover', 'hoverStrong', 'border', 'borderStrong', 'text', 'textBright',
      'textSoft', 'dim', 'faint', 'accent', 'accentStrong', 'link', 'good', 'warn', 'danger', 'gil', 'address', 'fc', 'fcPoints']) {
      vars[`--${kebab(k)}`] = t[k];
    }
    vars['--row-alt'] = rgba(t.rowAlt);
    vars['--heading'] = t.heading || t.text;
    vars['--glow'] = t.glow ? `0 0 12px ${t.accent}` : 'none';
    for (const [k, v] of Object.entries(t.roles)) vars[`--role-${kebab(k)}`] = v;
    if (colourBlind) {
      Object.assign(vars, { '--good': t.cb.good, '--warn': t.cb.warn, '--danger': t.cb.danger });
      for (const k of ['--gil', '--address', '--fc', '--fc-points']) vars[k] = t.text;
      for (const k of Object.keys(t.roles)) vars[`--role-${kebab(k)}`] = t.text;
    }
    return vars;
  }

  // What this PC chose (kept on this PC, like the plugin's own settings).
  const LOOK_KEY = 'look';
  const COLOUR_BLIND_KEY = 'colourBlindStatus';
  function savedLook() {
    try {
      return { theme: themeByKey(localStorage.getItem(LOOK_KEY)).key, colourBlind: localStorage.getItem(COLOUR_BLIND_KEY) === 'true' };
    } catch {
      return { theme: DEFAULT_THEME, colourBlind: false };
    }
  }
  function applyLook(theme, colourBlind) {
    const el = document.documentElement;
    for (const [k, v] of Object.entries(themeVariables(theme, colourBlind))) el.style.setProperty(k, v);
    el.dataset.theme = themeByKey(theme).key;
    el.dataset.light = String(!!themeByKey(theme).tokens.light);
    el.style.colorScheme = themeByKey(theme).tokens.light ? 'light' : 'dark';
  }
  function saveLook(theme, colourBlind) {
    try {
      localStorage.setItem(LOOK_KEY, theme);
      localStorage.setItem(COLOUR_BLIND_KEY, String(!!colourBlind));
    } catch { /* not remembered */ }
    applyLook(theme, colourBlind);
    window.dispatchEvent(new CustomEvent('look-changed'));
  }

  const api = { THEMES, DEFAULT_THEME, appThemes, themeByKey, themeVariables, savedLook, applyLook, saveLook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.Themes = api;
    // Before anything is drawn, so the window never flashes the default look.
    const { theme, colourBlind } = savedLook();
    applyLook(theme, colourBlind);
  }
}(typeof window !== 'undefined' ? window : globalThis));
