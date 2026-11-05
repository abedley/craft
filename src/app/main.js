// The game: boots the screens (title -> campaign -> battle) into #root.
// If a battle was autosaved, it opens straight back into it.

import { Progress, BattleSave } from './campaign.js';
import { titleScreen, campaignScreen } from './screens/menus.js';
import { battleScreen } from './screens/battle.js';

const SCREENS = { title: titleScreen, campaign: campaignScreen, battle: battleScreen };

const root = document.getElementById('root');
let current = null;

const app = {
  progress: new Progress(),
  save: new BattleSave(),
  show(name, args = {}) {
    current?.destroy?.();
    root.replaceChildren();
    current = SCREENS[name](app, args);
    current.name = name;
    root.append(current.el);
    current.mounted?.();
  },
  get screen() { return current; },
};

// Exposed for poking at the game from the console (and for tests).
window.craft = app;

// Start once the pixel fonts are in (so the first screen doesn't jump).
const fontsReady = document.fonts?.load ? Promise.all([document.fonts.load('16px "Silkscreen"'), document.fonts.load('16px "Pixelify Sans"')]).catch(() => {}) : Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => (app.save.levelId ? app.show('battle', { levelId: app.save.levelId }) : app.show('title')));
