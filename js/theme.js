// Applies this device's appearance before first paint (see "Appearance" in Settings). Loaded
// in the page's head, before the stylesheet is used, so the theme never flashes.
try {
  const l = JSON.parse(localStorage.getItem('dashboard-look')) || {};
  if (l.font === 'large') document.documentElement.dataset.font = l.font; // (the old pixel/plain choice: standard)
  if (l.theme) document.documentElement.dataset.theme = l.theme;
} catch (e) {}
// The system bar's colour: the page's, for the theme chosen here (else the system's, by the
// meta tags' own media queries).
function themeBar() {
  const t = document.documentElement.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (!m.dataset.media) m.dataset.media = m.media || '';
    m.media = t ? '' : m.dataset.media;
    if (!m.dataset.color) m.dataset.color = m.content;
    m.content = t === 'dark' ? '#12161c' : t === 'light' ? '#f5f6f8' : m.dataset.color;
  });
}
themeBar();
