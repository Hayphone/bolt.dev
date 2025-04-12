import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { ApiConfig } from '~/lib/stores/settings';

// Types pour les pièces jointes
interface Attachment {
  name: string;
  type: string;
  base64: string;
}

// Types pour les données de la requête
interface ChatRequestData {
  messages: Messages;
  apiConfig?: ApiConfig;
  data?: {
    apiConfig?: ApiConfig;
    apiConfigData?: ApiConfig;
    attachments?: Attachment[];
  };
}

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  // Récupérer et extraire les données JSON de la requête
  const requestData = await request.json() as ChatRequestData;
  
  // Extraire les messages
  const messages = requestData.messages;
  
  // Extraire la configuration API
  let apiConfig: ApiConfig | undefined = requestData.apiConfig;
  
  // Si la config n'est pas au niveau racine, vérifier dans data
  if (!apiConfig && requestData.data) {
    apiConfig = requestData.data.apiConfig || requestData.data.apiConfigData;
  }
  
  // Extraire les pièces jointes (attachements)
  let attachments: Attachment[] | undefined;
  if (requestData.data?.attachments) {
    attachments = requestData.data.attachments;
    
    // Enrichir le dernier message utilisateur avec les liens vers les images
    // pour les rendre directement visibles par le LLM
    if (messages.length > 0) {
      const lastUserMessageIndex = messages.findIndex(msg => msg.role === "user");
      
      if (lastUserMessageIndex !== -1) {
        let imageMarkdown = "\n\n";
        attachments.forEach(attachment => {
          if (attachment.type.startsWith('image/')) {
            // Ajouter une balise Markdown pour l'image
            imageMarkdown += `![${attachment.name}](${attachment.base64})\n`;
          }
        });
        
        // Ajouter les images au contenu du message utilisateur
        if (imageMarkdown.length > 2) {
          messages[lastUserMessageIndex].content += imageMarkdown;
        }
      }
    }
  }

  const stream = new SwitchableStream();

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      apiConfig,  // Transmet la configuration au streamText
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(messages, context.cloudflare.env, {...options, apiConfig});

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(messages, context.cloudflare.env, options);

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        contentType: 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error("Erreur lors de l'appel à l'API:", error);
    
    // Préparer un message d'erreur détaillé pour l'utilisateur
    let errorMessage = "Une erreur s'est produite lors de la communication avec l'API.";
    
    // Vérifier si l'erreur contient un message spécifique
    if (error instanceof Error) {
      // Détection des erreurs courantes
      if (error.message.includes("API key")) {
        errorMessage = "Erreur de clé API: Veuillez vérifier que votre clé API est valide dans les paramètres.";
      } else if (error.message.includes("timeout") || error.message.includes("network")) {
        errorMessage = "Erreur de connexion: Problème réseau lors de la communication avec le serveur API.";
      } else if (error.message.includes("rate limit") || error.message.includes("429")) {
        errorMessage = "Limite de requêtes atteinte: Veuillez réessayer dans quelques minutes.";
      } else {
        // Erreur générique avec le message d'origine
        errorMessage = `Erreur: ${error.message}`;
      }
    }
    
    // Renvoyer une réponse avec le message d'erreur
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
