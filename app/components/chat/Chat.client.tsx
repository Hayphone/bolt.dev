import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { apiConfigStore } from '~/lib/stores/settings';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  // Récupération de la configuration API
  const apiConfig = useStore(apiConfigStore);
  
  // Création d'un objet plat pour la transmission (compatible avec JSONValue)
  const apiConfigData = {
    provider: apiConfig.provider,
    apiKey: apiConfig.apiKey,
    endpoint: apiConfig.endpoint || "", // Garantir que la valeur n'est jamais undefined
  };

  const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
    api: '/api/chat',
    body: {
      apiConfig: apiConfigData, // Transmet la configuration API au serveur avec le nom attendu
    },
    onError: (error) => {
      logger.error('Request failed\n\n', error);
      
      // Fonction pour extraire un message d'erreur plus convivial
      const getErrorMessage = () => {
        // Cas de base: erreur standard JavaScript
        if (error instanceof Error) {
          return error.message;
        }
        
        // Cas pour les réponses HTTP et autres objets
        try {
          // Convertir à string pour analyser le contenu
          const errorStr = String(error);
          
          // Vérifier différentes conditions d'erreur
          if (errorStr.includes("API key")) {
            return "Erreur de clé API: Veuillez vérifier que votre clé API est valide dans les paramètres.";
          } else if (errorStr.includes("timeout") || errorStr.includes("network") || errorStr.includes("fetch")) {
            return "Erreur de connexion: Problème réseau lors de la communication avec le serveur API.";
          } else if (errorStr.includes("rate limit") || errorStr.includes("429")) {
            return "Limite de requêtes atteinte: Veuillez réessayer dans quelques minutes.";
          }
          
          // Essayer d'extraire un message JSON
          if (typeof error === 'object' && error !== null) {
            // Essayer d'accéder à error.error ou error.message
            const errorObj = error as Record<string, any>;
            if (errorObj.error) return String(errorObj.error);
            if (errorObj.message) return String(errorObj.message);
            
            // Chercher un texte de statut si c'est une réponse HTTP
            if (errorObj.statusText) return String(errorObj.statusText);
          }
          
          // Fallback: retourner la chaîne d'erreur complète
          return errorStr;
        } catch (e) {
          // En cas d'erreur lors de l'analyse, retourner un message générique
          return "Une erreur s'est produite lors de la communication avec l'API.";
        }
      };
      
      // Obtenir le message d'erreur formaté
      const errorMessage = getErrorMessage();
      
      // Afficher le toast avec le message approprié
      toast.error(errorMessage);
      
      // Si c'est un problème de clé API, suggérer de vérifier les paramètres
      if (errorMessage.includes("clé API") || errorMessage.includes("API key")) {
        toast.info("Vérifiez votre configuration API dans les paramètres", {
          autoClose: 8000,
          hideProgressBar: false
        });
      }
    },
    onFinish: () => {
      logger.debug('Finished streaming');
    },
    initialMessages,
  });

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  // Fonction pour gérer les fichiers sélectionnés
  const handleFilesSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setAttachedFiles(prevFiles => [...prevFiles, ...files]);
      toast.info(`${files.length} fichier(s) attaché(s)`);
    }
  }, []);

  // Fonction pour supprimer un fichier attaché
  const handleRemoveFile = useCallback((fileIndex: number) => {
    setAttachedFiles(prevFiles => {
      const newFiles = [...prevFiles];
      newFiles.splice(fileIndex, 1);
      return newFiles;
    });
    toast.info('Fichier supprimé');
  }, []);

  // Fonction pour préparer les fichiers à envoyer
  const prepareFilesForUpload = async (): Promise<{ name: string, type: string, base64: string }[]> => {
    return Promise.all(
      attachedFiles.map(async (file) => {
        return new Promise<{ name: string, type: string, base64: string }>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            // Convertir le fichier en base64
            const base64String = reader.result as string;
            resolve({
              name: file.name,
              type: file.type,
              base64: base64String
            });
          };
          reader.readAsDataURL(file);
        });
      })
    );
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if ((_input.length === 0 && attachedFiles.length === 0) || isLoading) {
      return;
    }

    /**
     * @note (delm) Usually saving files shouldn't take long but it may take longer if there
     * many unsaved files. In that case we need to block user input and show an indicator
     * of some kind so the user is aware that something is happening. But I consider the
     * happy case to be no unsaved files and I would expect users to save their changes
     * before they send another message.
     */
    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();

    chatStore.setKey('aborted', false);

    runAnimation();

    // Préparer les fichiers pour l'envoi
    let fileAttachments: { name: string, type: string, base64: string }[] = [];
    if (attachedFiles.length > 0) {
      fileAttachments = await prepareFilesForUpload();
    }

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);

      // Construction du contenu avec les fichiers attachés
      let content = `${diff}\n\n${_input}`;
      if (fileAttachments.length > 0) {
        content += `\n\nFichiers attachés: ${attachedFiles.map(f => f.name).join(', ')}`;
      }

      append({
        role: 'user', 
        content: content,
      }, {
        data: JSON.parse(JSON.stringify({ 
          apiConfig: apiConfigData,
          attachments: fileAttachments.length > 0 ? fileAttachments : undefined
        }))
      });

      workbenchStore.resetAllFileModifications();
    } else {
      // Construction du contenu avec les fichiers attachés
      let content = _input;
      if (fileAttachments.length > 0) {
        const fileNames = attachedFiles.map(f => f.name).join(', ');
        content = content ? `${content}\n\nFichiers attachés: ${fileNames}` : `Fichiers attachés: ${fileNames}`;
      }

      append(
        { role: 'user', content: content },
        { 
          data: JSON.parse(JSON.stringify({ 
            apiConfig: apiConfigData,
            attachments: fileAttachments.length > 0 ? fileAttachments : undefined
          }))
        }
      );
    }

    // Réinitialiser les fichiers attachés après l'envoi
    setAttachedFiles([]);

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <BaseChat
      ref={animationScope}
      textareaRef={textareaRef}
      input={input}
      showChat={showChat}
      chatStarted={chatStarted}
      isStreaming={isLoading}
      enhancingPrompt={enhancingPrompt}
      promptEnhanced={promptEnhanced}
      sendMessage={sendMessage}
      messageRef={messageRef}
      scrollRef={scrollRef}
      handleInputChange={handleInputChange}
      handleStop={abort}
      messages={messages.map((message, i) => {
        if (message.role === 'user') {
          return message;
        }

        return {
          ...message,
          content: parsedMessages[i] || '',
        };
      })}
      enhancePrompt={() => {
        enhancePrompt(input, (input) => {
          setInput(input);
          scrollTextArea();
        }, apiConfigData);
      }}
      onFilesSelected={handleFilesSelected}
      onRemoveFile={handleRemoveFile}
      attachedFiles={attachedFiles}
    />
  );
});
