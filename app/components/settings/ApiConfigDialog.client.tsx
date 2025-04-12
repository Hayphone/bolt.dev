import { useStore } from '@nanostores/react';
import { memo, useCallback, useState } from 'react';
import {
  Dialog,
  DialogButton,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '~/components/ui/Dialog';
import { apiConfigStore, type ApiConfig, type ApiProvider } from '~/lib/stores/settings';

interface ApiConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export const ApiConfigDialog = memo(({ open, onClose }: ApiConfigDialogProps) => {
  const apiConfig = useStore(apiConfigStore);
  
  // État local pendant l'édition
  const [localConfig, setLocalConfig] = useState<ApiConfig>(() => ({ 
    ...apiConfig
  }));
  
  // Réinitialiser l'état local quand le dialogue s'ouvre
  const onOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setLocalConfig({ ...apiConfig });
    } else {
      onClose();
    }
  }, [apiConfig, onClose]);
  
  // Mettre à jour un champ spécifique
  const updateField = useCallback((field: keyof ApiConfig, value: string) => {
    setLocalConfig(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);
  
  // Mettre à jour spécifiquement le provider
  const updateProvider = useCallback((value: string) => {
    const provider = value as ApiProvider;
    setLocalConfig(prev => ({
      ...prev,
      provider,
      // Réinitialiser l'endpoint si on ne sélectionne pas 'custom'
      endpoint: provider === 'custom' ? prev.endpoint : undefined
    }));
  }, []);
  
  // Enregistrer les modifications
  const saveChanges = useCallback(() => {
    apiConfigStore.set(localConfig);
    onClose();
  }, [localConfig, onClose]);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <Dialog onClose={onClose}>
        <DialogTitle>Configuration de l'API</DialogTitle>
        
        <DialogDescription>
          <div className="mb-4">
            <p className="text-sm text-bolt-elements-textSecondary mb-2">
              Configurez le fournisseur d'API pour votre modèle de langage
            </p>
          </div>
          
          {/* Sélection du fournisseur */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Fournisseur d'API</label>
            <select 
              className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md"
              value={localConfig.provider}
              onChange={(e) => updateProvider(e.target.value)}
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
              <option value="gemini">Google (Gemini)</option>
              <option value="custom">API Personnalisée</option>
            </select>
          </div>
          
          {/* Clé API */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Clé API</label>
            <input 
              type="password"
              className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md"
              placeholder="Entrez votre clé API"
              value={localConfig.apiKey || ''}
              onChange={(e) => updateField('apiKey', e.target.value)}
            />
            <p className="text-xs text-bolt-elements-textTertiary mt-1">
              Votre clé API est stockée localement dans votre navigateur et n'est jamais partagée.
            </p>
          </div>
          
          {/* Endpoint personnalisé (uniquement pour l'option "custom") */}
          {localConfig.provider === 'custom' && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">URL de l'API personnalisée</label>
              <input 
                type="text"
                className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md"
                placeholder="https://api.exemple.com"
                value={localConfig.endpoint || ''}
                onChange={(e) => updateField('endpoint', e.target.value)}
              />
            </div>
          )}
        </DialogDescription>
        
        {/* Boutons d'action */}
        <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
          <DialogButton type="secondary" onClick={onClose}>
            Annuler
          </DialogButton>
          {/* Conditionnellement rendre le bouton "Enregistrer" normalement ou désactivé visuellement */}
          {(!localConfig.apiKey && localConfig.provider !== 'anthropic') ? (
            <button
              className="inline-flex h-[35px] items-center justify-center rounded-lg px-4 text-sm leading-none focus:outline-none bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text opacity-50 cursor-not-allowed"
            >
              Enregistrer
            </button>
          ) : (
            <DialogButton 
              type="primary" 
              onClick={saveChanges}
            >
              Enregistrer
            </DialogButton>
          )}
        </div>
      </Dialog>
    </DialogRoot>
  );
});
