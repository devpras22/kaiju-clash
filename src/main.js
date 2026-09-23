import { Game } from './core/Game.js';

const game = new Game(document.getElementById('game'), document.getElementById('ui'));
window.__game = game; // debug / automated testing hook
game.start();
