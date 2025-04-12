import { map, type MapStore } from 'nanostores';
import { workbenchStore } from './workbench';

// Types de fournisseurs d'API supportés
export type ApiProvider = 'anthropic' | 'openai' | 'gemini' | 'custom';

// Configuration du fournisseur d'API
export interface ApiConfig {
  provider: ApiProvider;
  apiKey: string;
  endpoint?: string; // Pour les API personnalisées
}

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlOrMetaKey?: boolean;
  action: () => void;
}

export interface Shortcuts {
  toggleTerminal: Shortcut;
}

export interface Settings {
  shortcuts: Shortcuts;
  api: ApiConfig;
}

// Valeurs par défaut pour la configuration API
export const DEFAULT_API_CONFIG: ApiConfig = {
  provider: 'anthropic', // Valeur par défaut
  apiKey: '',
  endpoint: undefined,
};

export const shortcutsStore = map<Shortcuts>({
  toggleTerminal: {
    key: 'j',
    ctrlOrMetaKey: true,
    action: () => workbenchStore.toggleTerminal(),
  },
});

// Fonction pour obtenir la configuration initiale de l'API
function getInitialApiConfig(): ApiConfig {
  if (typeof window !== 'undefined') {
    try {
      // Essayer de récupérer la configuration du localStorage
      const savedConfig = localStorage.getItem('bolt_api_config');
      if (savedConfig) {
        const parsedConfig = JSON.parse(savedConfig) as ApiConfig;
        console.info('Configuration API chargée depuis localStorage');
        return parsedConfig;
      }
    } catch (error) {
      console.error('Erreur lors du chargement de la configuration API :', error);
    }
  }
  
  console.info('Configuration API par défaut utilisée');
  
  // Utiliser les valeurs par défaut si aucune configuration n'est trouvée
  return { ...DEFAULT_API_CONFIG };
}

// Store pour les paramètres API
export const apiConfigStore: MapStore<ApiConfig> = map<ApiConfig>(getInitialApiConfig());

// Sauvegarder automatiquement dans localStorage quand la config change
apiConfigStore.subscribe((newConfig) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('bolt_api_config', JSON.stringify(newConfig));
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la configuration API :', error);
    }
  }
});

export const settingsStore = map<Settings>({
  shortcuts: shortcutsStore.get(),
  api: apiConfigStore.get(),
});

shortcutsStore.subscribe((shortcuts) => {
  settingsStore.set({
    ...settingsStore.get(),
    shortcuts,
  });
});

apiConfigStore.subscribe((api) => {
  settingsStore.set({
    ...settingsStore.get(),
    api,
  });
});
