// Relays analysis requests from the content script to the Stockfish engine,
// which runs in an offscreen document (content scripts can't start an
// extension Worker on chess.com's origin).

let activeTabId = null;
let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the Stockfish WASM engine in a Web Worker.'
    }).finally(() => { creating = null; });
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.target === 'background' && sender.tab) {
    // From the content script
    activeTabId = sender.tab.id;
    ensureOffscreen().then(() =>
      chrome.runtime.sendMessage({ ...msg, target: 'offscreen' })
    );
  } else if (msg.target === 'background-from-engine') {
    // From the offscreen engine → forward to the page
    if (activeTabId != null) {
      chrome.tabs.sendMessage(activeTabId, { ...msg, target: 'content' }).catch(() => {});
    }
  }
});
