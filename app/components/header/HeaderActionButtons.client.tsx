import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { ApiConfigDialog } from '~/components/settings/ApiConfigDialog.client';
import { ProjectManager } from '~/components/project/ProjectManager.client';
import { GitHubImporter } from '~/components/github/GitHubImporter.client';
import { ThemeSelector } from '~/components/ui/ThemeSelector';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface HeaderActionButtonsProps {}

export function HeaderActionButtons({}: HeaderActionButtonsProps) {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const { showChat } = useStore(chatStore);
  
  // États pour contrôler l'affichage des dialogues
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showGitHubImporter, setShowGitHubImporter] = useState(false);

  const canHideChat = showWorkbench || !showChat;

  return (
    <div className="flex gap-2">
      {/* Bouton de gestion de projets */}
      <Button
        onClick={() => setShowProjectManager(true)}
        className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
      >
        <div className="i-ph:folder-simple-duotone" title="Gestion des projets" />
      </Button>
      
      {/* Bouton Git */}
      <Button
        onClick={() => {
          workbenchStore.showWorkbench.set(true);
          workbenchStore.currentView.set('git');
        }}
        className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
      >
        <div className="i-ph:git-branch-duotone text-sm" title="Gestion Git" />
      </Button>
      
      {/* Bouton de configuration API */}
      <Button
        onClick={() => setShowApiConfig(true)}
        className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
      >
        <div className="i-ph:gear-six-duotone" title="Configuration API" />
      </Button>
      
      {/* Dialogues */}
      <ApiConfigDialog 
        open={showApiConfig} 
        onClose={() => setShowApiConfig(false)} 
      />
      
      <ProjectManager
        open={showProjectManager}
        onClose={() => setShowProjectManager(false)}
      />
      
      <GitHubImporter
        open={showGitHubImporter}
        onClose={() => setShowGitHubImporter(false)}
      />
      
      {/* Sélecteur de thème */}
      <ThemeSelector className="mr-2" />
      
      <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden">
        <Button
          active={showChat}
          disabled={!canHideChat}
          onClick={() => {
            if (canHideChat) {
              chatStore.setKey('showChat', !showChat);
            }
          }}
        >
          <div className="i-bolt:chat text-sm" />
        </Button>
        <div className="w-[1px] bg-bolt-elements-borderColor" />
        <Button
          active={showWorkbench}
          onClick={() => {
            if (showWorkbench && !showChat) {
              chatStore.setKey('showChat', true);
            }

            workbenchStore.showWorkbench.set(!showWorkbench);
          }}
        >
          <div className="i-ph:code-bold" />
        </Button>
      </div>
    </div>
  );
}

interface ButtonProps {
  active?: boolean;
  disabled?: boolean;
  children?: any;
  onClick?: VoidFunction;
  className?: string;
}

function Button({ active = false, disabled = false, children, onClick, className }: ButtonProps) {
  return (
    <button
      className={classNames('flex items-center p-1.5', className, {
        'bg-bolt-elements-item-backgroundDefault hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary':
          !active,
        'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent': active && !disabled,
        'bg-bolt-elements-item-backgroundDefault text-alpha-gray-20 dark:text-alpha-white-20 cursor-not-allowed':
          disabled,
      })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
