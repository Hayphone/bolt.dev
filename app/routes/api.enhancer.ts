import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { StreamingTextResponse, parseStreamPart } from 'ai';
import { streamText } from '~/lib/.server/llm/stream-text';
import { stripIndents } from '~/utils/stripIndent';
import type { ApiConfig } from '~/lib/stores/settings';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function action(args: ActionFunctionArgs) {
  return enhancerAction(args);
}

async function enhancerAction({ context, request }: ActionFunctionArgs) {
  try {
    const { message, apiConfig } = await request.json<{ message: string; apiConfig?: ApiConfig }>();

    // Si le message est vide, renvoyer une erreur
    if (!message || message.trim() === '') {
      return new Response('Le message ne peut pas être vide', { status: 400 });
    }

    console.log("Enhance prompt appelé avec apiConfig:", apiConfig);

    // Création d'un mock simple pour gérer le cas où aucune API n'est configurée
    if (!apiConfig || !apiConfig.apiKey) {
      // Retourner une réponse simulée qui améliore légèrement le prompt
      // Ceci est une solution de secours quand aucune API n'est disponible
      const enhancedPrompt = message.trim() + (
        message.endsWith('.') || message.endsWith('?') || message.endsWith('!') ? 
        '' : '.'
      );
      
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(enhancedPrompt));
          controller.close();
        }
      });
      
      return new StreamingTextResponse(stream);
    }

    const result = await streamText(
      [
        {
          role: 'user',
          content: stripIndents`
          Je vais te donner un prompt utilisateur entre balises \`<original_prompt>\`.
          Ton rôle est d'améliorer ce prompt pour le rendre plus clair, précis et efficace.
          
          Instructions:
          1. Structurer le prompt de façon logique
          2. Clarifier les demandes ambiguës
          3. Ajouter des détails pertinents si nécessaire
          4. Corriger les erreurs grammaticales ou de syntaxe
          5. Optimiser pour obtenir la meilleure réponse possible
          
          IMPORTANT: Réponds UNIQUEMENT avec le prompt amélioré, sans aucun texte supplémentaire!

          <original_prompt>
            ${message}
          </original_prompt>
        `,
        },
      ],
      context.cloudflare.env,
      { apiConfig } // Passer la configuration API
    );

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const processedChunk = decoder
          .decode(chunk)
          .split('\n')
          .filter((line) => line !== '')
          .map(parseStreamPart)
          .map((part) => part.value)
          .join('');

        controller.enqueue(encoder.encode(processedChunk));
      },
    });

    const transformedStream = result.toAIStream().pipeThrough(transformStream);

    return new StreamingTextResponse(transformedStream);
  } catch (error) {
    console.log(error);

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
