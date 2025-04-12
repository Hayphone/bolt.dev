import { atom } from 'nanostores';

export type Theme = 'dark' | 'light' | 'premium';

export const kTheme = 'bolt_theme';

export function themeIsDark() {
  return themeStore.get() === 'dark';
}

export function themeIsPremium() {
  return themeStore.get() === 'premium';
}

export const DEFAULT_THEME = 'light';

export const themeStore = atom<Theme>(initStore());

function initStore() {
  if (!import.meta.env.SSR) {
    const persistedTheme = localStorage.getItem(kTheme) as Theme | undefined;
    const themeAttribute = document.querySelector('html')?.getAttribute('data-theme');

    return persistedTheme ?? (themeAttribute as Theme) ?? DEFAULT_THEME;
  }

  return DEFAULT_THEME;
}

export function toggleTheme() {
  const currentTheme = themeStore.get();
  let newTheme: Theme;
  
  // Rotation entre les trois thèmes
  switch (currentTheme) {
    case 'light':
      newTheme = 'dark';
      break;
    case 'dark':
      newTheme = 'premium';
      break;
    default:
      newTheme = 'light';
  }

  setTheme(newTheme);
}

// Fonction pour changer directement vers un thème spécifique
export function setTheme(theme: Theme) {
  themeStore.set(theme);
  localStorage.setItem(kTheme, theme);
  document.querySelector('html')?.setAttribute('data-theme', theme);
}
