import { createAnthropic } from '@ai-sdk/anthropic';

// Fonction pour obtenir un modèle Anthropic Claude
export function getAnthropicModel(apiKey: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  return anthropic('claude-3-5-sonnet-20240620');
}

// Fonction pour obtenir un modèle OpenAI
export function getOpenAIModel(apiKey: string) {
  // Note: Nous utilisons l'API de Anthropic comme base et adaptons la réponse 
  // Idéalement, nous installerions @ai-sdk/openai, mais ceci est une solution transitoire
  const anthropic = createAnthropic({
    apiKey,
  });

  // Pour l'instant, utilisons Claude comme fallback
  // Dans une implémentation réelle, nous utiliserions la SDK OpenAI
  console.warn('OpenAI support not fully implemented, using Anthropic as fallback');
  return anthropic('claude-3-5-sonnet-20240620');
}

// Fonction pour obtenir un modèle Google Gemini
export function getGeminiModel(apiKey: string) {
  // Note: Même approche que pour OpenAI
  const anthropic = createAnthropic({
    apiKey,
  });

  // Pour l'instant, utilisons Claude comme fallback
  console.warn('Gemini support not fully implemented, using Anthropic as fallback');
  return anthropic('claude-3-5-sonnet-20240620');
}

// Fonction pour obtenir un modèle personnalisé avec un endpoint spécifique
export function getCustomModel(apiKey: string, endpoint?: string) {
  // Pour un modèle personnalisé, nous utiliserions l'endpoint fourni
  // Mais ici, utilisons encore Claude comme fallback
  const anthropic = createAnthropic({
    apiKey,
  });

  console.warn('Custom model support not fully implemented, using Anthropic as fallback');
  return anthropic('claude-3-5-sonnet-20240620');
}
