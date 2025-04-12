import { useState } from 'react';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('usePromptEnhancement');

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);

  const resetEnhancer = () => {
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (input: string, setInput: (value: string) => void, apiConfig?: any) => {
    if (!input || input.trim() === '') {
      logger.warn('Tentative d\'amélioration d\'un prompt vide');
      return;
    }
    
    setEnhancingPrompt(true);
    setPromptEnhanced(false);
    
    const originalInput = input;
    let enhancedInput = '';
    let hasReceivedFirstChunk = false;

    try {
      const response = await fetch('/api/enhancer', {
        method: 'POST',
        body: JSON.stringify({
          message: input,
          apiConfig: apiConfig, // Transmettre la configuration API
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Erreur API: ${response.status} ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      
      if (!reader) {
        throw new Error('Impossible de lire la réponse');
      }
      
      const decoder = new TextDecoder();
      
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          break;
        }
        
        const chunk = decoder.decode(value);
        enhancedInput += chunk;
        
        // Ne vider le champ qu'après avoir reçu la première partie de la réponse
        if (!hasReceivedFirstChunk && chunk.trim() !== '') {
          hasReceivedFirstChunk = true;
          setInput('');
        }
        
        logger.trace('Set input', enhancedInput);
        setInput(enhancedInput);
      }
      
      // S'assurer que le texte final est correctement appliqué
      if (enhancedInput.trim() !== '') {
        setInput(enhancedInput);
        setPromptEnhanced(true);
      } else {
        // Si aucun texte n'a été reçu, restaurer l'original
        logger.warn('Aucun texte amélioré reçu');
        setInput(originalInput);
      }
      
    } catch (error) {
      logger.error('Erreur lors de l\'amélioration du prompt:', error);
      // Restaurer l'entrée originale en cas d'erreur
      setInput(originalInput);
      // Afficher un message d'erreur dans la console
      console.error('Erreur lors de l\'amélioration du prompt:', error);
    } finally {
      setEnhancingPrompt(false);
    }
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
