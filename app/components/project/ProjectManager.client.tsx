import { useState, useCallback, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { useProjectManager } from '~/lib/persistence/useProjectManager';
import { Dialog, DialogButton, DialogRoot, DialogTitle, DialogDescription } from '~/components/ui/Dialog';
import { workbenchStore } from '~/lib/stores/workbench';
import JSZip from 'jszip';
import { classNames } from '~/utils/classNames';
import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';
import * as nodePath from 'node:path';

const logger = createScopedLogger('ProjectManager');

interface ProjectManagerProps {
  open: boolean;
  onClose: () => void;
}

// L'interface principale du gestionnaire de projets
export const ProjectManager = ({ open, onClose }: ProjectManagerProps) => {
  // Mode export uniquement
  const [projectName, setProjectName] = useState('');
  
  // Reset lors de l'ouverture du dialogue
  useEffect(() => {
    if (open) {
      setProjectName('');
    }
  }, [open]);
  
  // Gérer l'export en ZIP
  const handleExport = useCallback(async () => {
    try {
      const zip = new JSZip();
      const webContainerInstance = await webcontainer;
      
      // Fonction récursive pour ajouter des fichiers/dossiers au ZIP
      const addToZip = async (currentPath: string, zipFolder: JSZip) => {
        const entries = await webContainerInstance.fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const entryPath = nodePath.join(currentPath, entry.name);
          
          if (entry.isDirectory()) {
            // Créer un dossier dans le ZIP et appel récursif
            const newFolder = zipFolder.folder(entry.name) || zipFolder;
            await addToZip(entryPath, newFolder);
          } else {
            // Ajouter le fichier au ZIP
            const fileContent = await webContainerInstance.fs.readFile(entryPath);
            zipFolder.file(entry.name, fileContent);
          }
        }
      };
      
      // Ajouter récursivement tous les fichiers/dossiers
      await addToZip('/', zip);
      
      // Générer le ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Créer un URL pour le téléchargement
      const url = URL.createObjectURL(zipBlob);
      
      // Créer un élément <a> et déclencher le téléchargement
      const link = document.createElement('a');
      link.href = url;
      link.download = projectName.trim() ? `${projectName}.zip` : 'bolt-project.zip';
      document.body.appendChild(link);
      link.click();
      
      // Nettoyer
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
      
      onClose();
    } catch (error) {
      logger.error('Erreur lors de l\'export ZIP:', error);
    }
  }, [onClose, projectName]);
  
  return (
    <DialogRoot open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog onClose={onClose}>
        <DialogTitle>
          <div className="flex items-center justify-between w-full pr-6">
            <div>Gestionnaire de Projets</div>
          </div>
        </DialogTitle>
        
        <DialogDescription asChild>
          <div>
            <div className="p-4">
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Nom du fichier ZIP</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md"
                  placeholder="mon-projet"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
                <p className="text-xs text-bolt-elements-textTertiary mt-1">
                  L'extension .zip sera ajoutée automatiquement
                </p>
              </div>
              
              <div className="my-4 text-center">
                <div className="i-ph:file-zip-duotone text-5xl text-bolt-elements-textSecondary"></div>
                <p className="mt-2 text-sm text-bolt-elements-textSecondary">
                  Exporte tous les fichiers du projet actuel dans un fichier ZIP
                </p>
              </div>
            </div>
            
            <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
              <DialogButton type="secondary" onClick={onClose}>
                Annuler
              </DialogButton>
              <DialogButton type="primary" onClick={handleExport}>
                Télécharger ZIP
              </DialogButton>
            </div>
          </div>
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
};
