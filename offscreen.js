// Hosts the Stockfish engine and speaks UCI to it.

const engine = new Worker('engine/stockfish-19-lite-single.js');
let searching = false;
let queued = null;   // next request waiting for the current search to stop
let current = null;  // request being searched
let lines = [];

function send(cmd) { engine.postMessage(cmd); }

send('uci');
send('setoption name Hash value 32');
send('isready');

function start(req) {
  current = req;
  lines = [];
  searching = true;
  send('setoption name MultiPV value ' + req.multipv);
  send('position fen ' + req.fen);
  send('go depth ' + req.depth);
}

engine.onmessage = (e) => {
  const line = String(e.data);

  if (line.startsWith('bestmove')) {
    searching = false;
    if (current && !queued) {
      chrome.runtime.sendMessage({ target: 'background-from-engine', type: 'done', fen: current.fen });
    }
    if (queued) { const q = queued; queued = null; start(q); }
    return;
  }

  if (!line.startsWith('info') || !current || queued) return;
  const depth = /\bdepth (\d+)/.exec(line);
  const pv = /\bpv (.+)$/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  if (!depth || !pv || !score) return;
  const idx = (Number((/\bmultipv (\d+)/.exec(line) || [0, 1])[1])) - 1;

  lines[idx] = {
    depth: Number(depth[1]),
    type: score[1],               // 'cp' or 'mate'
    value: Number(score[2]),      // from side-to-move's point of view
    pv: pv[1].split(' ')
  };

  chrome.runtime.sendMessage({
    target: 'background-from-engine',
    type: 'info',
    fen: current.fen,
    lines: lines.filter(Boolean)
  });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'analyze') {
    const req = { fen: msg.fen, depth: msg.depth || 16, multipv: msg.multipv || 1 };
    if (searching) { queued = req; send('stop'); }
    else start(req);
  } else if (msg.type === 'stop') {
    queued = null;
    if (searching) send('stop');
  }
});
