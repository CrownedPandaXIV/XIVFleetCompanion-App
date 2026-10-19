// What the player runs: subs, retainers, or both. Chosen in Settings → General → "What do you run?"
// (tier3_settings 'play_style'); "Work it out" (auto, the default) decides from the data: built subs and
// retainers with a class among the tracked characters. Tabs, Summary sections and alerts for what is not
// run are left out. No Electron or pg here, so it can be tested on its own (tests/play-style.test.js).

const PLAY_STYLE_KEY = 'play_style';
const PLAY_STYLES = ['auto', 'both', 'subs', 'retainers'];

// Tabs only for subs, and only for retainers (the keys of renderer/app.jsx's VIEWS).
const SUB_VIEWS = ['salvage', 'subs', 'supplies', 'parts', 'routeOpt'];
const RETAINER_VIEWS = ['retainers'];

// counts: { subs: built subs, retainers: retainers with a class }. Nothing yet counts as both.
function detectPlayStyle(counts) {
  const subs = Number(counts && counts.subs) > 0;
  const retainers = Number(counts && counts.retainers) > 0;
  if (subs && !retainers) return 'subs';
  if (retainers && !subs) return 'retainers';
  return 'both';
}

// The saved choice ('auto' when nothing valid is saved) and what it comes to.
function resolvePlayStyle(saved, counts) {
  const choice = PLAY_STYLES.includes(saved) ? saved : 'auto';
  return { choice, style: choice === 'auto' ? detectPlayStyle(counts) : choice };
}

function playStyleUses(style) {
  return { subs: style !== 'retainers', retainers: style !== 'subs' };
}

function hiddenViews(style) {
  const uses = playStyleUses(style);
  return [...(uses.subs ? [] : SUB_VIEWS), ...(uses.retainers ? [] : RETAINER_VIEWS)];
}

// Alert settings with the alerts for what is not run turned off.
function alertSettingsFor(settings, style) {
  const uses = playStyleUses(style);
  return {
    ...settings,
    subsOn: settings.subsOn && uses.subs,
    suppliesOn: settings.suppliesOn && uses.subs,
    buildOn: settings.buildOn && uses.subs,
    retainersOn: settings.retainersOn && uses.retainers,
    undercutOn: settings.undercutOn && uses.retainers,
  };
}

module.exports = { PLAY_STYLE_KEY, PLAY_STYLES, SUB_VIEWS, RETAINER_VIEWS, detectPlayStyle, resolvePlayStyle, playStyleUses, hiddenViews, alertSettingsFor };
