// The game: boots the screens (title -> campaign -> battle) into #root.

import { Progress } from './campaign.js';
import { titleScreen, campaignScreen } from './screens/menus.js';
import { battleScreen } from './screens/battle.js';

const SCREENS = { title: titleScreen, campaign: campaignScreen, battle: battleScreen };

const root = document.getElementById('root');
let current = null;

const app = {
  progress: new Progress(),
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

// Draw once the hand-lettered font is in (canvas text needs it loaded).
const fontsReady = document.fonts?.load ? document.fonts.load('16px "Patrick Hand"').catch(() => {}) : Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => app.show('title'));
