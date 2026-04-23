const THEME_KEY = "ums.theme";
const FONT_SIZE_KEY = "ums.fontSize";

export const themeOptions = ["light", "dark"];
export const fontSizeOptions = ["small", "medium", "large"];

export function getThemePreference() {
  const value = localStorage.getItem(THEME_KEY);
  return themeOptions.includes(value) ? value : "light";
}

export function setThemePreference(value) {
  const next = themeOptions.includes(value) ? value : "light";
  localStorage.setItem(THEME_KEY, next);
  return next;
}

export function getFontSizePreference() {
  const value = localStorage.getItem(FONT_SIZE_KEY);
  return fontSizeOptions.includes(value) ? value : "medium";
}

export function setFontSizePreference(value) {
  const next = fontSizeOptions.includes(value) ? value : "medium";
  localStorage.setItem(FONT_SIZE_KEY, next);
  return next;
}

export function applyUiPreferences({ theme, fontSize }) {
  const root = document.documentElement;
  root.dataset.theme = themeOptions.includes(theme) ? theme : getThemePreference();
  root.dataset.fontSize = fontSizeOptions.includes(fontSize) ? fontSize : getFontSizePreference();
}
