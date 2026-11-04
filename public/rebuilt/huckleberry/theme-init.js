// Runs before first paint (external file so it is allowed by a strict script-src 'self').
(function () {
  try {
    var mode = localStorage.getItem('nestlog-theme') || 'auto';
    var h = new Date().getHours();
    var night = mode === 'night' || (mode === 'auto' && (h >= 19 || h < 7));
    document.documentElement.setAttribute('data-theme', night ? 'night' : 'day');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', night ? '#120000' : '#f6f1ea');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'day');
  }
})();
