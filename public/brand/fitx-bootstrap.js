try {
  var fitxStoredTheme = window.localStorage.getItem("fitx-theme");
  document.documentElement.dataset.theme =
    fitxStoredTheme === "light" || fitxStoredTheme === "dark" || fitxStoredTheme === "system"
      ? fitxStoredTheme
      : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

try {
  var fitxIntroKey = "fitx-cinematic-seen";
  var fitxReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (
    window.location.pathname === "/" &&
    !fitxReduceMotion &&
    window.sessionStorage.getItem(fitxIntroKey) !== "1"
  ) {
    document.documentElement.dataset.fitxIntro = "pending";
    window.setTimeout(function () {
      if (document.documentElement.dataset.fitxIntro === "pending") {
        document.documentElement.removeAttribute("data-fitx-intro");
      }
    }, 3600);
  }
} catch {
  // If browser storage is unavailable, keep the site immediately accessible.
}
