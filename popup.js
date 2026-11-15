const defaults = { enabled: true, depth: 16, multipv: 3, onlyMyTurn: true };

chrome.storage.sync.get(defaults, (s) => {
  enabled.checked = s.enabled;
  onlyMyTurn.checked = s.onlyMyTurn;
  multipv.value = String(s.multipv);
  depth.value = s.depth;
});

enabled.onchange = () => chrome.storage.sync.set({ enabled: enabled.checked });
onlyMyTurn.onchange = () => chrome.storage.sync.set({ onlyMyTurn: onlyMyTurn.checked });
multipv.onchange = () => chrome.storage.sync.set({ multipv: Number(multipv.value) });
depth.onchange = () => {
  const d = Math.min(24, Math.max(6, Number(depth.value) || 16));
  depth.value = d;
  chrome.storage.sync.set({ depth: d });
};
