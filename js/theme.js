// Applies this device's appearance before first paint (see "Appearance" in Settings). Loaded
// in the page's head, before the stylesheet is used, so the theme never flashes.
try {
  const l = JSON.parse(localStorage.getItem('dashboard-look')) || {};
  if (l.font === 'large') document.documentElement.dataset.font = l.font; // (the old pixel/plain choice: standard)
  if (l.theme) document.documentElement.dataset.theme = l.theme;
} catch (e) {}
