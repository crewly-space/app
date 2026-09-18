(() => {
  const saved = localStorage.getItem("opencrew:theme");
  const theme = saved === "light" || saved === "dark"
    ? saved
    : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#f6f6f8" : "#0b0b0c";
})();
