# Bot Coach

Stockfish 19 (lite, runs locally in your browser) that draws best-move arrows
on Chess.com pages with a supported board.

## Install in Brave
1. Unzip this folder somewhere permanent.
2. Go to brave://extensions and switch on "Developer mode" (top right).
3. Click "Load unpacked" and pick the unzipped `bot-coach` folder.
4. Open any Chess.com page with a supported board and start a game.

## Use
- Green arrow = best move, blue/yellow = 2nd/3rd best.
- Panel bottom-right: evaluation (from White's view), depth, top lines.
- Alt+B hides/shows everything. Click the toolbar icon for settings
  (lines, depth, "arrows only on my turn").

## Files
- content.js: reads the board from the page, builds the FEN, draws arrows
- background.js: relays messages
- offscreen.js: runs Stockfish (WASM, in a Web Worker) via UCI
- engine/: Stockfish.js 19 (GPLv3, see STOCKFISH-LICENSE.txt)
