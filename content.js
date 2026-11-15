// Bot Coach – content script.
// Reads the Chess.com board, builds a FEN, asks Stockfish for the best moves
// and draws arrows + an info panel. Only active on the bot page and the
// analysis board; it switches itself off anywhere else (Chess.com navigates
// without full page reloads, so the URL is re-checked continuously).

(() => {
  const ALLOWED = [];
  const isAllowedPage = () => ALLOWED.some((re) => re.test(location.pathname));

  const settings = { enabled: true, depth: 16, multipv: 3, onlyMyTurn: true };
  let board = null;
  let svg = null;
  let panel = null;
  let lastFen = null;
  let latest = null; // latest engine result for lastFen
  let flipped = false;
  let currentStm = "w";

  // ---------- settings ----------
  chrome.storage.sync.get(settings, (s) => {
    Object.assign(settings, s);
    refresh(true);
  });
  chrome.storage.onChanged.addListener((changes) => {
    for (const k in changes) settings[k] = changes[k].newValue;
    refresh(true);
  });

  // ---------- board reading ----------
  function findBoard() {
    return document.querySelector("wc-chess-board, chess-board");
  }

  // "square-52" → { file: 5, rank: 2 }
  function squareOf(el) {
    const m = /\bsquare-(\d)(\d)\b/.exec(el.className);
    return m ? { file: Number(m[1]), rank: Number(m[2]) } : null;
  }

  function readPosition(b) {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(null)); // [file][rank]
    for (const el of b.querySelectorAll(".piece")) {
      const sq = squareOf(el);
      const code = /\b([wb][pnbrqk])\b/.exec(el.className);
      if (sq && code) grid[sq.file][sq.rank] = code[1];
    }
    const highlights = [...b.querySelectorAll(".highlight")]
      .map(squareOf)
      .filter(Boolean);
    return { grid, highlights };
  }

  function sideToMove(grid, highlights) {
    // Chess.com highlights the two squares of the last move. The piece now
    // standing on one of them is the one that just moved.
    for (const sq of highlights) {
      const p = grid[sq.file][sq.rank];
      if (p) return p[0] === "w" ? "b" : "w";
    }
    return "w"; // no last move → starting position
  }

  function castling(grid) {
    let s = "";
    if (grid[5][1] === "wk") {
      if (grid[8][1] === "wr") s += "K";
      if (grid[1][1] === "wr") s += "Q";
    }
    if (grid[5][8] === "bk") {
      if (grid[8][8] === "br") s += "k";
      if (grid[1][8] === "br") s += "q";
    }
    return s || "-";
  }

  function enPassant(grid, highlights, stm) {
    if (highlights.length !== 2) return "-";
    const [a, b] = highlights;
    if (a.file !== b.file || Math.abs(a.rank - b.rank) !== 2) return "-";
    const to = grid[a.file][a.rank] ? a : b;
    const p = grid[to.file][to.rank];
    if (p !== (stm === "w" ? "bp" : "wp")) return "-";
    const epRank = (a.rank + b.rank) / 2;
    return "abcdefgh"[to.file - 1] + epRank;
  }

  function toFen({ grid, highlights }) {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = "",
        empty = 0;
      for (let f = 1; f <= 8; f++) {
        const p = grid[f][r];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += p[0] === "w" ? p[1].toUpperCase() : p[1];
      }
      rows.push(row + (empty || ""));
    }
    const stm = sideToMove(grid, highlights);
    return {
      fen: `${rows.join("/")} ${stm} ${castling(grid)} ${enPassant(grid, highlights, stm)} 0 1`,
      stm,
    };
  }

  function validKings(fen) {
    const placement = fen.split(" ")[0];
    return (
      (placement.match(/K/g) || []).length === 1 &&
      (placement.match(/k/g) || []).length === 1
    );
  }

  // ---------- drawing ----------
  function ensureOverlay() {
    if (!svg || !board.contains(svg)) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.classList.add("botcoach-arrows");
      svg.innerHTML = `<defs>
        ${[0, 1, 2]
          .map(
            (
              i,
            ) => `<marker id="bc-head-${i}" viewBox="0 0 10 10" refX="5" refY="5"
          markerWidth="3" markerHeight="3" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="bc-head bc-c${i}"/></marker>`,
          )
          .join("")}
      </defs><g class="bc-layer"></g>`;
      board.appendChild(svg);
    }
    if (!panel || !document.body.contains(panel)) {
      panel = document.createElement("div");
      panel.className = "botcoach-panel";
      document.body.appendChild(panel);
    }
  }

  function center(sqName) {
    const f = sqName.charCodeAt(0) - 96;
    const r = Number(sqName[1]);
    const x = flipped ? (8.5 - f) * 12.5 : (f - 0.5) * 12.5;
    const y = flipped ? (r - 0.5) * 12.5 : (8.5 - r) * 12.5;
    return { x, y };
  }

  function fmtScore(line, stm) {
    const sign = stm === "w" ? 1 : -1; // convert to White's point of view
    if (line.type === "mate") {
      const m = line.value * sign;
      return (m > 0 ? "+" : "-") + "M" + Math.abs(m);
    }
    const v = (line.value * sign) / 100;
    return (v > 0 ? "+" : "") + v.toFixed(2);
  }

  function clearDrawing() {
    if (svg) svg.querySelector(".bc-layer").innerHTML = "";
  }

  function draw(stm) {
    ensureOverlay();
    const layer = svg.querySelector(".bc-layer");
    layer.innerHTML = "";
    const myColor = flipped ? "b" : "w";
    const hideArrows = settings.onlyMyTurn && stm !== myColor;

    if (!latest || !latest.lines.length) {
      panel.innerHTML = `<b>Bot Coach</b><div class="bc-muted">Thinking…</div>`;
      return;
    }

    if (!hideArrows) {
      // Draw weaker lines first so the best arrow sits on top
      latest.lines
        .slice(0, settings.multipv)
        .map((l, i) => [l, i])
        .reverse()
        .forEach(([l, i]) => {
          const mv = l.pv[0];
          const a = center(mv.slice(0, 2));
          const b = center(mv.slice(2, 4));
          // stop a little short so the arrow head lands inside the target square
          const dx = b.x - a.x,
            dy = b.y - a.y,
            len = Math.hypot(dx, dy) || 1;
          const ex = b.x - (dx / len) * 3,
            ey = b.y - (dy / len) * 3;
          const ln = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line",
          );
          ln.setAttribute("x1", a.x);
          ln.setAttribute("y1", a.y);
          ln.setAttribute("x2", ex);
          ln.setAttribute("y2", ey);
          ln.setAttribute("class", `bc-arrow bc-c${i}`);
          ln.setAttribute("marker-end", `url(#bc-head-${i})`);
          layer.appendChild(ln);
        });
    }

    const best = latest.lines[0];
    panel.innerHTML = `
      <div class="bc-top"><b>Bot Coach</b><span class="bc-eval">${fmtScore(best, stm)}</span></div>
      <div class="bc-muted">depth ${best.depth} · ${stm === "w" ? "White" : "Black"} to move
        ${hideArrows ? "· waiting for your turn" : ""}</div>
      ${latest.lines
        .slice(0, settings.multipv)
        .map(
          (l, i) => `
        <div class="bc-line"><span class="bc-dot bc-c${i}"></span>
          <span class="bc-score">${fmtScore(l, stm)}</span>
          <span class="bc-pv">${l.pv.slice(0, 6).join(" ")}</span></div>`,
        )
        .join("")}
      <div class="bc-muted bc-hint">Alt+B to hide/show</div>`;
  }

  function teardown() {
    if (!svg && !panel && !lastFen) return;
    if (svg) svg.remove();
    if (panel) panel.remove();
    svg = panel = null;
    lastFen = null;
    latest = null;
    chrome.runtime
      .sendMessage({ target: "background", type: "stop" })
      .catch(() => {});
  }

  // ---------- main loop ----------

  function refresh(force = false) {
    if (!isAllowedPage() || !settings.enabled) {
      teardown();
      return;
    }
    board = findBoard();
    if (!board) return;
    flipped = board.classList.contains("flipped");

    const pos = readPosition(board);
    const { fen, stm } = toFen(pos);
    if (!validKings(fen)) return; // mid-animation or not loaded
    currentStm = stm;

    if (fen !== lastFen || force) {
      if (fen !== lastFen) latest = null;
      lastFen = fen;
      chrome.runtime
        .sendMessage({
          target: "background",
          type: "analyze",
          fen,
          depth: settings.depth,
          multipv: settings.multipv,
        })
        .catch(() => {});
    }
    draw(stm);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== "content" || msg.fen !== lastFen) return;
    if (msg.type === "info") {
      latest = { lines: msg.lines };
      draw(currentStm);
    }
  });

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(), 120);
  };
  const ours = (n) => (svg && svg.contains(n)) || (panel && panel.contains(n));
  new MutationObserver((muts) => {
    if (muts.some((m) => !ours(m.target))) schedule();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  setInterval(() => {
    if (!isAllowedPage()) teardown();
  }, 1000);

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyB") {
      settings.enabled = !settings.enabled;
      chrome.storage.sync.set({ enabled: settings.enabled });
    }
  });

  refresh();
})();
