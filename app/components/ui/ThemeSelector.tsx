import { useStore } from '@nanostores/react';
import { memo, useState, useEffect } from 'react';
import { themeStore, setTheme } from '~/lib/stores/theme';
import type { Theme } from '~/lib/stores/theme';

interface ThemeSelectorProps {
  className?: string;
}

export const ThemeSelector = memo(({ className }: ThemeSelectorProps) => {
  const currentTheme = useStore(themeStore);
  const [domLoaded, setDomLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDomLoaded(true);
  }, []);

  if (!domLoaded) return null;

  const handleThemeSelection = (theme: Theme) => {
    setTheme(theme);
    setExpanded(false);
  };

  return (
    <div className={`theme-selector relative ${className}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`theme-selector-toggle flex items-center gap-2 px-3 py-2 rounded-md ${
          currentTheme === 'premium' ? 'premium-ripple text-amber-400' : ''
        }`}
        aria-label="Sélectionner un thème"
      >
        <span className="theme-icon">
          {currentTheme === 'light' && <div className="i-ph-sun-dim-duotone w-5 h-5" />}
          {currentTheme === 'dark' && <div className="i-ph-moon-stars-duotone w-5 h-5" />}
          {currentTheme === 'premium' && <div className="i-ph-sparkle-duotone w-5 h-5" />}
        </span>
        <span className="theme-name hidden sm:inline">
          {currentTheme === 'light' && 'Thème Clair'}
          {currentTheme === 'dark' && 'Thème Sombre'}
          {currentTheme === 'premium' && 'Thème Premium'}
        </span>
        <span className="theme-arrow">
          <div className={`i-ph-caret-down w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {expanded && (
        <div className="theme-options absolute top-full right-0 mt-1 p-2 rounded-md shadow-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor z-50 min-w-[180px] text-bolt-elements-textPrimary">
          <button
            onClick={() => handleThemeSelection('light')}
            className={`theme-option w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-bolt-elements-background-depth-3 ${
              currentTheme === 'light' ? 'bg-bolt-elements-background-depth-3' : ''
            }`}
          >
            <span className="theme-icon">
              <div className="i-ph-sun-dim-duotone w-5 h-5" />
            </span>
            <span className="theme-label">Thème Clair</span>
          </button>

          <button
            onClick={() => handleThemeSelection('dark')}
            className={`theme-option w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-bolt-elements-background-depth-3 ${
              currentTheme === 'dark' ? 'bg-bolt-elements-background-depth-3' : ''
            }`}
          >
            <span className="theme-icon">
              <div className="i-ph-moon-stars-duotone w-5 h-5" />
            </span>
            <span className="theme-label">Thème Sombre</span>
          </button>

          <button
            onClick={() => handleThemeSelection('premium')}
            className={`theme-option w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-bolt-elements-background-depth-3 ${
              currentTheme === 'premium' ? 'bg-bolt-elements-background-depth-3 text-[#FFD700]' : ''
            }`}
          >
            <span className="theme-icon">
              <div className="i-ph-sparkle-duotone w-5 h-5" />
            </span>
            <span className="theme-label">Thème Premium</span>
            <span className="ml-auto text-xs">✨</span>
          </button>
        </div>
      )}
    </div>
  );
});
