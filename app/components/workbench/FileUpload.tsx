import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import * as nodePath from 'node:path';
import { WORK_DIR } from '~/utils/constants';
import { toast } from 'react-toastify';
import JSZip from 'jszip';

const logger = createScopedLogger('FileUpload');

interface FileUploadProps {
  className?: string;
}

export const FileUpload = memo(({ className }: FileUploadProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Gérer le glisser-déposer
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const { files } = e.dataTransfer;
    if (files && files.length > 0) {
      await handleFiles(files);
    }
  }, []);

  // Gérer le clic sur le bouton
  const handleButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Gérer la sélection de fichiers
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleFiles(e.target.files);
      // Réinitialiser l'input pour permettre de sélectionner à nouveau le même fichier
      e.target.value = '';
    }
  }, []);

  // Fonction pour extraire et importer les fichiers d'un ZIP
  const extractAndImportZip = async (zipFile: File) => {
    try {
      toast.info(`Extraction du fichier ZIP "${zipFile.name}" en cours...`);
      
      const buffer = await zipFile.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      
      let totalFiles = 0;
      let importedFiles = 0;
      let failedFiles = 0;
      
      // Compter le nombre total de fichiers (pas les dossiers)
      Object.keys(zip.files).forEach(filename => {
        if (!zip.files[filename].dir) {
          totalFiles++;
        }
      });
      
      // Créer un toast de progression
      const progressToastId = toast.info(`Extraction de ${totalFiles} fichiers...`);
      
      // Traiter chaque fichier dans le ZIP
      const zipEntries = Object.entries(zip.files);
      
      // Traiter en séquence pour éviter des problèmes de mémoire ou de performance
      for (const [filename, zipEntry] of zipEntries) {
        // Ignorer les dossiers
        if (zipEntry.dir) continue;
        
        try {
          // Extraire le contenu du fichier
          const content = await zipEntry.async('uint8array');
          
          // Construire le chemin cible
          const targetPath = nodePath.join(WORK_DIR, filename);
          
          // Importer le fichier
          await workbenchStore.importFile(targetPath, content);
          importedFiles++;
          
          // Mettre à jour le toast de progression tous les 5 fichiers
          if (importedFiles % 5 === 0 || importedFiles === totalFiles) {
            toast.update(progressToastId, {
              render: `Importation: ${importedFiles}/${totalFiles} fichiers (${Math.round((importedFiles / totalFiles) * 100)}%)`,
            });
          }
        } catch (error) {
          logger.error(`Échec de l'import du fichier ${filename} depuis le ZIP:`, error);
          failedFiles++;
        }
      }
      
      // Afficher le résultat final
      toast.dismiss(progressToastId);
      if (failedFiles === 0) {
        toast.success(`${importedFiles} fichiers importés avec succès depuis le ZIP`);
      } else {
        toast.warning(`${importedFiles} fichiers importés, ${failedFiles} échecs depuis le ZIP`);
      }
      
      return { importedFiles, failedFiles };
    } catch (error) {
      logger.error(`Erreur lors de l'extraction du ZIP "${zipFile.name}":`, error);
      toast.error(`Échec de l'extraction du ZIP: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      return { importedFiles: 0, failedFiles: 1 };
    }
  };

  // Traiter les fichiers importés
  const handleFiles = async (files: FileList) => {
    // Convertir FileList en tableau pour le traitement
    const fileArray = Array.from(files);
    let successCount = 0;
    let failCount = 0;
    
    // Si un seul fichier ZIP, le traiter spécialement
    if (fileArray.length === 1 && fileArray[0].name.toLowerCase().endsWith('.zip')) {
      const result = await extractAndImportZip(fileArray[0]);
      return;
    }
    
    // Afficher toast de démarrage pour les fichiers non-ZIP
    toast.info(`Import de ${fileArray.length} fichier(s) en cours...`);

    // Traiter chaque fichier
    for (const file of fileArray) {
      try {
        // Si c'est un ZIP, l'extraire
        if (file.name.toLowerCase().endsWith('.zip')) {
          const result = await extractAndImportZip(file);
          successCount += result.importedFiles;
          failCount += result.failedFiles;
        } else {
          // Traitement normal pour les fichiers non-ZIP
          const buffer = await file.arrayBuffer();
          const content = new Uint8Array(buffer);
          // Déterminer le chemin cible dans le WebContainer
          const targetPath = nodePath.join(WORK_DIR, file.name);

          await workbenchStore.importFile(targetPath, content);
          successCount++;
        }
      } catch (error) {
        logger.error(`Échec de l'import du fichier ${file.name}:`, error);
        failCount++;
      }
    }

    // Afficher un toast avec le résultat pour les fichiers non-ZIP
    if (fileArray.length > 1 || !fileArray[0].name.toLowerCase().endsWith('.zip')) {
      if (failCount === 0) {
        toast.success(`${successCount} fichier(s) importé(s) avec succès`);
      } else {
        toast.warning(`${successCount} fichier(s) importé(s), ${failCount} échec(s)`);
      }
    }
  };

  // Classes pour la zone de dépôt
  const dropzoneClasses = useMemo(() => {
    return classNames(
      'border-2 border-dashed rounded-lg p-4 text-center transition-all duration-200 ease-in-out',
      {
        'border-bolt-elements-item-borderAccent bg-bolt-elements-item-backgroundAccent bg-opacity-10': isDragging,
        'border-bolt-border-secondary hover:border-bolt-border-primary': !isDragging,
      },
      className
    );
  }, [isDragging, className]);

  return (
    <div
      className={dropzoneClasses}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleButtonClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex flex-col items-center justify-center gap-2 py-2">
        <div className={classNames(
          'i-ph:upload-simple-duotone text-3xl',
          isDragging ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textSecondary'
        )} />
        <p className={classNames(
          'text-sm font-medium',
          isDragging ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textSecondary'
        )}>
          {isDragging 
            ? 'Déposer les fichiers ici' 
            : 'Glisser-déposer des fichiers ou cliquer pour parcourir'}
        </p>
      </div>
    </div>
  );
});
