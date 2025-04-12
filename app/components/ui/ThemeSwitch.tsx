import { useStore } from '@nanostores/react';
import { memo, useEffect, useState } from 'react';
import { themeStore, toggleTheme } from '~/lib/stores/theme';
import { IconButton } from './IconButton';

interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch = memo(({ className }: ThemeSwitchProps) => {
  const theme = useStore(themeStore);
  const [domLoaded, setDomLoaded] = useState(false);

  useEffect(() => {
    setDomLoaded(true);
  }, []);

  // Détermine l'icône à afficher en fonction du thème actuel
  const getThemeIcon = () => {
    switch (theme) {
      case 'dark':
        return 'i-ph-sun-dim-duotone'; // Soleil pour le thème sombre actuel
      case 'premium':
        return 'i-ph-sparkle-duotone'; // Étincelle pour le thème premium actuel
      default: // 'light'
        return 'i-ph-moon-stars-duotone'; // Lune pour le thème clair actuel
    }
  };

  // Détermine le titre de l'infobulle en fonction du thème suivant
  const getNextThemeTitle = () => {
    switch (theme) {
      case 'light':
        return 'Passer au thème sombre';
      case 'dark':
        return 'Passer au thème premium';
      case 'premium':
        return 'Passer au thème clair';
    }
  };

  return (
    domLoaded && (
      <IconButton
        className={`${className} ${theme === 'premium' ? 'text-amber-400' : ''}`}
        icon={getThemeIcon()}
        size="xl"
        title={getNextThemeTitle()}
        onClick={toggleTheme}
      />
    )
  );
});
