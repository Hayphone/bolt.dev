import { useState, useRef } from 'react';
import { toast } from 'react-toastify';
import { db, getAll, setMessages, type ChatHistoryItem } from '~/lib/persistence';
import { logger } from '~/utils/logger';

export function ChatExportImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!db) {
      toast.error('Base de données non disponible');
      return;
    }

    try {
      setExporting(true);
      const chats = await getAll(db);
      
      if (chats.length === 0) {
        toast.info('Aucune conversation à exporter');
        return;
      }

      // Préparer les données pour l'export
      const exportData = {
        format: 'bolt-conversations',
        version: '1.0',
        timestamp: new Date().toISOString(),
        chats
      };

      // Créer un blob et le télécharger
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      
      // Nom du fichier avec date
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `bolt-conversations-${dateStr}.json`;
      a.href = url;
      a.click();
      
      URL.revokeObjectURL(url);
      toast.success(`${chats.length} conversations exportées`);
    } catch (error) {
      logger.error('Erreur lors de l\'export des conversations:', error);
      toast.error('Erreur lors de l\'export des conversations');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const processImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!db) {
      toast.error('Base de données non disponible');
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const fileContent = await file.text();
      const importData = JSON.parse(fileContent);
      
      // Vérifier le format
      if (!importData.format || importData.format !== 'bolt-conversations') {
        toast.error('Format de fichier invalide');
        return;
      }
      
      // Importer les conversations
      let importCount = 0;
      for (const chat of importData.chats) {
        try {
          if (chat.id && chat.messages && Array.isArray(chat.messages)) {
            await setMessages(
              db, 
              chat.id, 
              chat.messages, 
              chat.urlId, 
              chat.description
            );
            importCount++;
          }
        } catch (chatError) {
          logger.error(`Erreur lors de l'import de la conversation ${chat.id}:`, chatError);
        }
      }
      
      if (importCount > 0) {
        toast.success(`${importCount} conversation(s) importée(s)`);
        // Recharger la page pour voir les nouvelles conversations
        window.location.reload();
      } else {
        toast.error('Aucune conversation valide trouvée');
      }
    } catch (error) {
      logger.error('Erreur lors de l\'import des conversations:', error);
      toast.error('Erreur lors de l\'import des conversations');
    }
    
    // Réinitialiser le champ de fichier
    event.target.value = '';
  };

  return (
    <div className="flex flex-col gap-2 mt-2">
      <button
        disabled={exporting || !db}
        onClick={handleExport}
        title="Exporter les conversations"
        className="flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary disabled:opacity-50 hover:bg-bolt-elements-background-depth-4 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-bolt-elements-textSecondary">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM13 7H11V11H7V13H11V17H13V13H17V11H13V7Z" fill="currentColor"/>
        </svg>
        <span>Exporter les conversations</span>
      </button>
      
      <button
        disabled={!db}
        onClick={handleImport}
        title="Importer des conversations"
        className="flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary disabled:opacity-50 hover:bg-bolt-elements-background-depth-4 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-bolt-elements-textSecondary">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM16 13H13V16H11V13H8V11H11V8H13V11H16V13Z" fill="currentColor"/>
        </svg>
        <span>Importer des conversations</span>
      </button>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={processImportFile}
        accept=".json"
        className="hidden"
      />
    </div>
  );
}
