// Light / dark theme, applied in <head> before the page paints. Dark by default, as on the other ChainIntegrate pages.
// The choice is kept in this browser only; without storage it lasts for the page only.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("ucl-theme"); } catch (e) { /* storage blocked */ }
  document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "dark");
})();
