import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getAnthropicModel, getOpenAIModel, getGeminiModel, getCustomModel } from '~/lib/.server/llm/model';
import { MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';
import type { ApiConfig } from '~/lib/stores/settings';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export interface StreamingOptions extends Omit<Parameters<typeof _streamText>[0], 'model'> {
  apiConfig?: ApiConfig; // Configuration optionnelle du client
}

export function streamText(messages: Messages, env: Env, options?: StreamingOptions) {
  const { apiConfig, ...restOptions } = options || {};
  
  // Sélectionne le modèle en fonction de la configuration fournie ou utilise Anthropic par défaut
  let model;
  let headers = {};
  
  if (apiConfig) {
    // Utilise la configuration client si disponible
    switch(apiConfig.provider) {
      case 'anthropic':
        model = getAnthropicModel(apiConfig.apiKey);
        headers = { 'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15' };
        break;
      case 'openai':
        model = getOpenAIModel(apiConfig.apiKey);
        break;
      case 'gemini':
        model = getGeminiModel(apiConfig.apiKey);
        break;
      case 'custom':
        model = getCustomModel(apiConfig.apiKey, apiConfig.endpoint);
        break;
      default:
        // Fallback à Anthropic
        model = getAnthropicModel(getAPIKey(env));
        headers = { 'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15' };
    }
  } else {
    // Utilise la configuration serveur par défaut
    model = getAnthropicModel(getAPIKey(env));
    headers = { 'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15' };
  }
  
  return _streamText({
    model,
    system: getSystemPrompt(),
    maxTokens: MAX_TOKENS,
    headers,
    messages: convertToCoreMessages(messages),
    ...restOptions,
  });
}
