import { memo, useRef, useCallback } from 'react';
import { classNames } from '~/utils/classNames';
import { createScopedLogger } from '~/utils/logger';
import { toast } from 'react-toastify';
import JSZip from 'jszip';

const logger = createScopedLogger('ChatFileUpload');

interface ChatFileUploadProps {
  onFileSelect?: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

export const ChatFileUpload = memo(({ onFileSelect, disabled = false, className }: ChatFileUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gérer le clic sur le bouton d'upload
  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  // Fonction pour examiner et extraire le contenu d'un ZIP si nécessaire
  const processFiles = useCallback(
    async (files: File[]) => {
      // Limiter la taille totale des fichiers
      const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      
      if (totalSize > MAX_TOTAL_SIZE) {
        toast.error(`La taille totale des fichiers ne doit pas dépasser ${MAX_TOTAL_SIZE / (1024 * 1024)}MB`);
        return;
      }

      // Vérifier si des fichiers ZIP sont présents
      const zipFiles = files.filter(file => file.name.toLowerCase().endsWith('.zip'));
      
      // S'il n'y a pas de ZIP, traiter normalement
      if (zipFiles.length === 0) {
        onFileSelect?.(files);
        return;
      }
      
      try {
        // Pour les fichiers ZIP, on propose l'option de les joindre tels quels ou de les extraire
        if (zipFiles.length > 0) {
          // Pour les pièces jointes dans le chat, on va toujours joindre le ZIP tel quel
          // car l'extraction complète pourrait générer trop de fichiers
          // Note: Si on souhaite implémenter l'extraction, on pourrait ajouter un dialogue de confirmation ici
          
          toast.info(`${zipFiles.length} fichier(s) ZIP joint(s). Pour extraire le contenu, utilisez la zone de dépôt dans l'éditeur.`);
          onFileSelect?.(files);
        }
      } catch (error) {
        logger.error('Erreur lors du traitement des fichiers ZIP:', error);
        toast.error('Erreur lors du traitement des fichiers ZIP');
      }
    },
    [onFileSelect]
  );

  // Gérer la sélection de fichiers
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;

      try {
        const filesArray = Array.from(e.target.files);
        
        // Traiter les fichiers (y compris les ZIP si présents)
        processFiles(filesArray);
        
        // Réinitialiser l'input pour permettre de sélectionner à nouveau les mêmes fichiers
        e.target.value = '';
      } catch (error) {
        logger.error('Erreur lors de la sélection des fichiers:', error);
        toast.error('Erreur lors de la sélection des fichiers');
      }
    },
    [processFiles]
  );

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        onChange={handleFileChange}
        accept="image/*, .pdf, .txt, .js, .jsx, .ts, .tsx, .html, .css, .json, .md, .zip"
      />
      <button
        type="button"
        className={classNames(
          'flex items-center justify-center p-1.5 rounded-md transition-colors',
          disabled 
            ? 'opacity-50 cursor-not-allowed text-bolt-elements-textTertiary' 
            : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
          className
        )}
        disabled={disabled}
        onClick={handleClick}
        title="Joindre des fichiers"
      >
        <div className="i-ph:paperclip-duotone text-lg"></div>
      </button>
    </>
  );
});
