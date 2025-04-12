import { useState, useCallback, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import JSZip from 'jszip';
import { Dialog, DialogButton, DialogRoot } from '~/components/ui/Dialog';
import { workbenchStore } from '~/lib/stores/workbench';
import { gitStore } from '~/lib/stores/git';
import { chatStore } from '~/lib/stores/chat';
import { githubTokenStore } from '~/lib/stores/github';
import { GitHubService } from '~/lib/services/github';
import { WORK_DIR } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import * as nodePath from 'node:path';
import { getNextId, openDatabase } from '~/lib/persistence/db';
import { webcontainer } from '~/lib/webcontainer';
import { GitHubTokenConfig } from './GitHubTokenConfig';

const logger = createScopedLogger('GitHubImporter');

interface GitHubImporterProps {
  open: boolean;
  onClose: () => void;
}

// Structure des métadonnées Git à stocker
interface GitMetadata {
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  lastImported: Date;
}

// Clé localStorage pour stocker les métadonnées du dépôt importé
const GIT_METADATA_KEY = 'bolt_git_metadata';

// Interface pour les items de l'API GitHub
interface GitHubItem {
  type: string;
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  download_url?: string;
  content?: string;
  encoding?: string;
}

export const GitHubImporter = ({ open, onClose }: GitHubImporterProps) => {
  // Récupérer le token GitHub du store
  const githubToken = useStore(githubTokenStore);
  const [showTokenConfig, setShowTokenConfig] = useState(false);
  // Naviguer vers une nouvelle session de chat
  const navigateToNewChat = async (repoName: string) => {
    // Ouvrir la base de données
    const db = await openDatabase();
    if (!db) {
      toast.error("Impossible d'ouvrir la base de données");
      return;
    }
    
    // Générer un nouvel ID
    const nextId = await getNextId(db);
    
    // Naviguer vers la nouvelle session
    const url = new URL(window.location.href);
    url.pathname = `/chat/${nextId}`;
    window.location.href = url.toString();
  };
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<number>(0);

  // Fonction pour extraire les informations du dépôt depuis l'URL
  const parseGitHubUrl = (url: string): { owner: string; repo: string } | null => {
    try {
      // Format: https://github.com/username/repository
      // ou: github.com/username/repository
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      
      if (urlObj.hostname !== 'github.com') {
        throw new Error('URL non valide');
      }
      
      const parts = urlObj.pathname.split('/').filter(p => p);
      
      if (parts.length < 2) {
        throw new Error('URL de dépôt GitHub non valide');
      }
      
      return {
        owner: parts[0],
        repo: parts[1],
      };
    } catch (err) {
      return null;
    }
  };

  // Sauvegarder les métadonnées Git dans localStorage
  const saveGitMetadata = (metadata: GitMetadata) => {
    try {
      localStorage.setItem(GIT_METADATA_KEY, JSON.stringify(metadata));
    } catch (err) {
      logger.error('Erreur lors de la sauvegarde des métadonnées Git:', err);
    }
  };

  // Extraire et importer les fichiers du ZIP
  const extractAndImportFiles = async (zip: JSZip, rootFolderName: string) => {
    const files = Object.entries(zip.files);
    const totalFiles = files.length;
    let processedFiles = 0;
    
    // Filtrer pour n'avoir que les fichiers (pas les dossiers)
    const fileEntries = files.filter(([_, zipEntry]) => !zipEntry.dir);
    
    // Taille des lots pour l'importation
    const BATCH_SIZE = 5;
    // Délai entre les lots (en ms)
    const BATCH_DELAY = 500;
    
    // Traiter les fichiers par lots
    for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
      const batch = fileEntries.slice(i, i + BATCH_SIZE);
      
      // Traitement du lot actuel
      const batchPromises = batch.map(async ([path, zipEntry]) => {
        // La première partie du chemin est le nom du dossier racine du ZIP, que nous devons supprimer
        const relativePath = path.startsWith(rootFolderName) 
          ? path.substring(rootFolderName.length) 
          : path;
        
        if (!relativePath) return; // Ignorer le fichier racine
        
        // Supprimer les éventuels séparateurs de chemin en tête
        const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
        
        try {
          // Obtenir le contenu du fichier
          const content = await zipEntry.async('uint8array');
          
          // Chemin complet pour WebContainer
          const fullPath = `${WORK_DIR}/${cleanPath}`;
          
          // Importer le fichier
          await workbenchStore.importFile(fullPath, content);
          
          // Mettre à jour la progression
          processedFiles++;
          setImportProgress(Math.round((processedFiles / totalFiles) * 100));
        } catch (error) {
          logger.error(`Erreur lors de l'importation du fichier ${cleanPath}:`, error);
        }
      });
      
      // Attendre que le lot actuel soit traité avant de passer au suivant
      await Promise.all(batchPromises);
      
      // Si ce n'est pas le dernier lot, attendre un peu avant de traiter le suivant
      // pour permettre à la mémoire d'être libérée
      if (i + BATCH_SIZE < fileEntries.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
      
      // Collecte manuelle des déchets (si disponible dans l'environnement)
      if (typeof window !== 'undefined' && 'gc' in window) {
        try {
          // @ts-ignore
          window.gc();
        } catch (e) {
          // Ignorer les erreurs - gc() n'est pas disponible dans tous les navigateurs
        }
      }
    }
  };

  // Importer récursivement des fichiers à partir de l'API GitHub
  const importGitHubFiles = async (
    github: GitHubService, 
    owner: string, 
    repo: string, 
    branch: string, 
    path: string = '',
    basePath: string = ''
  ) => {
    // Paramètres optimisés pour réduire drastiquement la consommation mémoire
    const BATCH_SIZE = 2; // Réduit à 2 fichiers par lot (très petit)
    const BATCH_DELAY = 800; // Augmenté à 800ms pour donner plus de temps au GC
    const MAX_FILE_SIZE = 1024 * 1024; // 1MB, limite pour les fichiers volumineux
    const MAX_DEPTH = 5; // Limite la profondeur de récursion
    const SCAN_BATCH_SIZE = 5; // Nombre de dossiers à scanner en parallèle
    
    // Structure pour collecter les fichiers à importer
    interface FileToImport {
      downloadUrl: string;
      targetPath: string;
      size: number;
      base64Content?: string;
      encoding?: string;
      isProcessed?: boolean;
    }
    
    // Nettoyage de mémoire agressif
    const forceGarbageCollection = async () => {
      // Essayer de forcer la libération de mémoire
      if (typeof window !== 'undefined' && 'gc' in window) {
        try {
          // @ts-ignore
          window.gc();
        } catch (e) {
          // Ignorer les erreurs - gc() n'est pas disponible dans tous les navigateurs
        }
      }
      
      // En plus d'appeler GC (quand disponible), on attend un délai
      // et on crée des allocations temporaires pour inciter le GC à s'exécuter
      await new Promise(resolve => {
        setTimeout(() => {
          // Allocation temporaire puis libération pour inciter le GC
          const temp = new Array(1000).fill(0);
          resolve(null);
          // temp est maintenant éligible au GC
        }, 100);
      });
    };
    
    // Fonction qui collecte les fichiers niveau par niveau (non récursive)
    // pour éviter l'explosion de la pile et mieux contrôler la mémoire
    const collectFilesLevelByLevel = async (): Promise<FileToImport[]> => {
      const allFiles: FileToImport[] = [];
      // Files d'attente des dossiers à explorer
      const foldersToProcess: { path: string; basePath: string; depth: number }[] = [
        { path, basePath, depth: 0 }
      ];
      
      let processedFolders = 0;
      const startTime = Date.now();
      
      // Tant qu'il reste des dossiers à explorer
      while (foldersToProcess.length > 0) {
        // Extraction d'un lot de dossiers à traiter en parallèle
        const folderBatch = foldersToProcess.splice(0, SCAN_BATCH_SIZE);
        processedFolders += folderBatch.length;
        
        // Si on a traité beaucoup de dossiers, afficher la progression
        if (processedFolders % 10 === 0) {
          const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
          toast.info(`Analyse du dépôt en cours: ${processedFolders} dossiers explorés (${elapsedSeconds}s)`);
          // Libération de mémoire périodique
          await forceGarbageCollection();
        }
        
        // Traiter ce lot de dossiers en parallèle (mais limité à SCAN_BATCH_SIZE)
        const folderPromises = folderBatch.map(async ({ path: folderPath, basePath: folderBasePath, depth }) => {
          if (depth > MAX_DEPTH) {
            logger.warn(`Profondeur maximale atteinte pour ${folderPath}, arrêt de la récursion`);
            return [];
          }
          
          try {
            // Obtenir le contenu du dossier
            const response = await github.getRepoContents(owner, repo, folderPath, branch);
            
            // Si c'est un fichier unique et non un dossier
            if (!Array.isArray(response)) {
              const fileItem = response as GitHubItem;
              if (fileItem.type === 'file' && fileItem.download_url) {
                // Vérifier la taille du fichier
                if (fileItem.size > MAX_FILE_SIZE) {
                  logger.warn(`Fichier ignoré car trop volumineux (${fileItem.size} bytes): ${fileItem.path}`);
                  return []; // Ignorer les fichiers trop volumineux
                }
                
                return [{
                  downloadUrl: fileItem.download_url,
                  targetPath: `${WORK_DIR}/${folderBasePath}${fileItem.name}`,
                  size: fileItem.size,
                  base64Content: fileItem.content,
                  encoding: fileItem.encoding
                }];
              }
              return [];
            }
            
            // C'est un tableau d'éléments dans un dossier
            const items = response as GitHubItem[];
            const result: FileToImport[] = [];
            
            // Pour chaque item du répertoire
            for (const item of items) {
              if (item.type === 'dir') {
                // C'est un dossier, à ajouter à la file d'attente
                const newBasePath = folderBasePath + item.path.replace(folderPath, '') + '/';
                // Ajouter à la file pour traitement ultérieur
                foldersToProcess.push({
                  path: item.path,
                  basePath: newBasePath,
                  depth: depth + 1
                });
              } else if (item.type === 'file' && item.download_url) {
                // Vérifier la taille du fichier
                if (item.size > MAX_FILE_SIZE) {
                  logger.warn(`Fichier ignoré car trop volumineux (${item.size} bytes): ${item.path}`);
                  continue; // Ignorer les fichiers trop volumineux
                }
                
                // C'est un fichier à importer
                result.push({
                  downloadUrl: item.download_url,
                  targetPath: `${WORK_DIR}/${folderBasePath}${item.name}`,
                  size: item.size,
                  base64Content: item.content,
                  encoding: item.encoding
                });
              }
            }
            
            return result;
          } catch (error) {
            // En cas d'erreur, on log mais on continue avec les autres dossiers
            logger.error(`Erreur lors de l'exploration du dossier ${folderPath}:`, error);
            
            // Si c'est une erreur 404, on l'ignore simplement
            if (error instanceof Error && error.message.includes('404')) {
              logger.warn(`Dossier non trouvé (404): ${folderPath}`);
              return [];
            }
            
            // Pour les autres erreurs, on log mais on ne bloque pas le processus
            return [];
          }
        });
        
        // Attendre le traitement de ce lot de dossiers
        try {
          const batchResults = await Promise.allSettled(folderPromises);
          
          // Traiter les résultats: ajouter les fichiers trouvés à notre liste
          batchResults.forEach(result => {
            if (result.status === 'fulfilled') {
              allFiles.push(...result.value);
            }
          });
          
          // Libérer la mémoire entre les lots
          await forceGarbageCollection();
        } catch (e) {
          logger.error('Erreur lors du traitement d\'un lot de dossiers:', e);
          // Continuer malgré l'erreur
        }
      }
      
      return allFiles;
    };
    
    // Importer les fichiers un par un avec délai entre chaque
    const importFilesSuperSafe = async (files: FileToImport[]) => {
      // On trie les fichiers par taille pour traiter les plus petits d'abord
      const sortedFiles = [...files].sort((a, b) => a.size - b.size);
      const totalFiles = sortedFiles.length;
      let processedFiles = 0;
      let successFiles = 0;
      
      logger.info(`Importation de ${totalFiles} fichiers un par un (ultra-safe mode)`);
      toast.info(`Démarrage de l'importation: ${totalFiles} fichiers à traiter`);
      
      // Traiter les fichiers
      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        
        try {
          // Afficher la progression toutes les 5 fichiers
          if (i % 5 === 0) {
            toast.info(`Importation en cours: ${i}/${totalFiles} fichiers (${Math.round((i/totalFiles)*100)}%)`);
          }
          
          // Essayer d'importer le fichier
          let content: Uint8Array | null = null;
          
          // Si le contenu est déjà disponible en base64, l'utiliser
          if (file.base64Content && file.encoding === 'base64') {
            try {
              content = Uint8Array.from(atob(file.base64Content), c => c.charCodeAt(0));
            } catch (e) {
              logger.warn(`Échec du décodage base64 pour ${file.targetPath}, téléchargement direct`);
              // Continuer pour télécharger directement
            }
          }
          
          // Si pas de contenu en base64 ou décodage échoué, télécharger directement
          if (!content) {
            try {
              const response = await fetch(file.downloadUrl);
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              
              // Vérifier à nouveau la taille (par sécurité)
              const contentLength = response.headers.get('content-length');
              if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
                logger.warn(`Fichier ignoré car trop volumineux: ${file.targetPath}`);
                continue; // Ignorer ce fichier
              }
              
              const blob = await response.blob();
              const buffer = await blob.arrayBuffer();
              content = new Uint8Array(buffer);
            } catch (e) {
              logger.error(`Échec du téléchargement pour ${file.targetPath}:`, e);
              // Continuer avec le fichier suivant
              continue;
            }
          }
          
          // Vérifier la taille du contenu avant l'importation
          if (content.length > MAX_FILE_SIZE) {
            logger.warn(`Fichier ignoré car trop volumineux (${content.length} bytes): ${file.targetPath}`);
            continue; // Ignorer ce fichier
          }
          
          // Importer le fichier
          await workbenchStore.importFile(file.targetPath, content);
          successFiles++;
          
          // Libérer la référence au contenu pour aider le GC
          content = null;
          
        } catch (error) {
          logger.error(`Erreur lors de l'importation du fichier ${file.targetPath}:`, error);
          // Continuer avec le fichier suivant
        }
        
        // Incrémenter le compteur et mettre à jour la progression
        processedFiles++;
        const progress = Math.round((processedFiles / totalFiles) * 98); // Plafond à 98%
        setImportProgress(progress);
        
        // Pause entre chaque fichier pour libérer la mémoire
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Toutes les 10 fichiers, faire une pause plus longue et forcer le GC
        if (i % 10 === 9) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
          await forceGarbageCollection();
        }
      }
      
      return { total: totalFiles, success: successFiles };
    };
    
    // Nouveau: Importer par lots ultra-petits avec délais et nettoyage mémoire
    const importFilesMicroBatches = async (files: FileToImport[]) => {
      // On trie les fichiers par taille pour traiter les plus petits d'abord
      const sortedFiles = [...files].sort((a, b) => a.size - b.size);
      const totalFiles = sortedFiles.length;
      let processedFiles = 0;
      let successFiles = 0;
      
      logger.info(`Importation de ${totalFiles} fichiers en micro-lots de ${BATCH_SIZE}`);
      
      // Traiter les fichiers par micro-lots
      for (let i = 0; i < sortedFiles.length; i += BATCH_SIZE) {
        // Extraction d'un lot de fichiers
        const batch = sortedFiles.slice(i, i + BATCH_SIZE);
        
        if (i % 20 === 0) {
          toast.info(`Importation en cours: ${i}/${totalFiles} fichiers (${Math.round((i/totalFiles)*100)}%)`);
        }
        
        // Traiter les fichiers de ce lot séquentiellement (pas en parallèle)
        for (const file of batch) {
          try {
            // Essayer d'importer le fichier
            let content: Uint8Array | null = null;
            
            // Si le contenu est déjà disponible en base64, l'utiliser
            if (file.base64Content && file.encoding === 'base64') {
              try {
                content = Uint8Array.from(atob(file.base64Content), c => c.charCodeAt(0));
              } catch (e) {
                // Si décodage échoue, on essaiera le téléchargement direct
                logger.warn(`Échec du décodage base64 pour ${file.targetPath}`);
              }
            }
            
            // Si pas de contenu en base64 ou décodage échoué, télécharger directement
            if (!content) {
              try {
                const response = await fetch(file.downloadUrl);
                if (!response.ok) {
                  throw new Error(`HTTP error! status: ${response.status}`);
                }
                const blob = await response.blob();
                const buffer = await blob.arrayBuffer();
                content = new Uint8Array(buffer);
              } catch (e) {
                logger.error(`Échec du téléchargement pour ${file.targetPath}:`, e);
                throw e;
              }
            }
            
            // Importer le fichier
            await workbenchStore.importFile(file.targetPath, content);
            successFiles++;
            
            // Libérer la référence au contenu pour aider le GC
            content = null;
            
          } catch (error) {
            logger.error(`Erreur lors de l'importation du fichier ${file.targetPath}:`, error);
            // Continuer avec le fichier suivant
          }
          
          // Mettre à jour la progression après chaque fichier
          processedFiles++;
          const progress = Math.round((processedFiles / totalFiles) * 98);
          setImportProgress(progress);
          
          // Pause courte entre chaque fichier (même au sein d'un lot)
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Attendre plus longtemps entre les lots
        if (i + BATCH_SIZE < sortedFiles.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
          await forceGarbageCollection();
        }
      }
      
      return { total: totalFiles, success: successFiles };
    };
    
    try {
      // Étape 1: Collecter les fichiers niveau par niveau (non récursif)
      logger.info(`Collecte des fichiers du dépôt ${owner}/${repo}, branche ${branch}`);
      toast.info(`Analyse de la structure du dépôt... Veuillez patienter.`);
      
      const filesToImport = await collectFilesLevelByLevel();
      logger.info(`${filesToImport.length} fichiers trouvés. Début de l'importation...`);
      
      // Si le nombre de fichiers est très limité, utiliser mode super-safe (un par un)
      if (filesToImport.length <= 10) {
        toast.info(`Mode d'importation: un par un (${filesToImport.length} fichiers)`);
        const result = await importFilesSuperSafe(filesToImport);
        logger.info(`Importation terminée: ${result.success}/${result.total} fichiers`);
      } 
      // Sinon utiliser des micro-lots
      else {
        toast.info(`Téléchargement de ${filesToImport.length} fichiers en micro-lots...`);
        const result = await importFilesMicroBatches(filesToImport);
        logger.info(`Importation terminée: ${result.success}/${result.total} fichiers`);
      }
      
    } catch (error) {
      logger.error('Erreur lors de l\'importation des fichiers:', error);
      
      // Messages d'erreur plus détaillés selon le type d'erreur
      if (error instanceof Error) {
        if (error.message.includes('memory')) {
          throw new Error('Erreur de mémoire: le dépôt est trop volumineux. Essayez de fermer d\'autres applications, utiliser un autre navigateur avec plus de mémoire, ou importer une partie du dépôt uniquement.');
        } else if (error.message.includes('rate limit')) {
          throw new Error('Limite de requêtes GitHub atteinte. Veuillez attendre quelques minutes avant de réessayer.');
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          throw new Error('Erreur réseau: vérifiez votre connexion internet et réessayez.');
        }
      }
      
      throw error;
    }
  };

  // Définition de handleImport
  const handleImport = useCallback(async () => {
    // Si pas de token GitHub, afficher la configuration du token
    if (!githubToken) {
      setShowTokenConfig(true);
      return;
    }
    
    if (!repoUrl.trim()) {
      setError('Veuillez entrer une URL de dépôt GitHub');
      return;
    }

    const repoInfo = parseGitHubUrl(repoUrl);
    
    if (!repoInfo) {
      setError('Format d\'URL GitHub invalide. Utilisez le format: https://github.com/utilisateur/depot');
      return;
    }

    setIsLoading(true);
    setError(null);
    setImportProgress(0);
    
    try {
      // Créer une instance du service GitHub avec le token
      const github = new GitHubService(githubToken);
      
      // Vérifier si le dépôt existe et est accessible
      try {
        await github.getRepoInfo(repoInfo.owner, repoInfo.repo);
      } catch (error) {
        logger.error('Erreur lors de la vérification du dépôt:', error);
        throw new Error('Dépôt introuvable ou inaccessible. Vérifiez l\'URL et vos permissions.');
      }
      
      // Vérifier si la branche existe
      try {
        const branchesResponse = await github.getBranches(repoInfo.owner, repoInfo.repo);
        const branches = branchesResponse as Array<{name: string, commit: {sha: string}}>;
        const branchExists = branches.some(b => b.name === branch);
        
        if (!branchExists) {
          const branchList = branches.map(b => b.name).join(', ');
          throw new Error(`La branche "${branch}" n'existe pas. Branches disponibles: ${branchList}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Branches disponibles')) {
          throw error;
        }
        logger.error('Erreur lors de la vérification des branches:', error);
        throw new Error('Erreur lors de la vérification des branches du dépôt.');
      }
      
      // Importer les fichiers depuis GitHub
      toast.info(`Téléchargement du dépôt: ${repoInfo.owner}/${repoInfo.repo}`);
      await importGitHubFiles(github, repoInfo.owner, repoInfo.repo, branch);
      
      // 4. Sauvegarder les métadonnées Git
      const metadata: GitMetadata = {
        repoUrl,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        branch,
        lastImported: new Date()
      };
      
      // Enregistrer les métadonnées dans localStorage et GitStore
      saveGitMetadata(metadata);
      
      // Initialiser Git dans le projet importé
      await gitStore.initRepo();
      
      // Simuler l'initialisation Git
      toast.info("Initialisation de Git...");
      
      // Mettre à jour la progression à 100% pour indiquer que l'importation est terminée
      setImportProgress(100);
      
      // Basculer vers l'onglet Git
      workbenchStore.currentView.set('git');
      
      toast.success(`Projet importé avec succès: ${repoInfo.owner}/${repoInfo.repo}`);
      
      // Rafraîchir l'interface
      workbenchStore.showWorkbench.set(true);
      
      // Fermer la boîte de dialogue après un court délai
      setTimeout(() => {
        onClose();
        
        // Démarrer une nouvelle session de chat avec le projet importé
        // Si on est déjà dans une session active, on reste dessus
        if (window.location.pathname === '/') {
          chatStore.setKey('started', true);
          navigateToNewChat(repoInfo.repo);
        }
      }, 300);
      
    } catch (error: any) {
      logger.error('Erreur lors de l\'importation:', error);
      setError(error.message || 'Erreur lors de l\'importation du dépôt');
      toast.error('Erreur lors de l\'importation');
    } finally {
      setIsLoading(false);
      setImportProgress(0);
    }
  }, [repoUrl, branch, onClose, githubToken]);
  
  // Gérer le token sauvegardé
  const handleTokenSaved = useCallback(() => {
    setShowTokenConfig(false);
    // Déclencher l'import automatiquement après la configuration du token
    if (repoUrl.trim() && parseGitHubUrl(repoUrl)) {
      setTimeout(() => handleImport(), 500);
    }
  }, [repoUrl, handleImport]);

  return (
    <>
      {/* Dialog de configuration du token GitHub */}
      <GitHubTokenConfig 
        open={showTokenConfig}
        onClose={() => setShowTokenConfig(false)}
        onSaved={handleTokenSaved}
      />
      
      {/* Dialog principal d'importation */}
      <DialogRoot open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog onClose={onClose}>
      <div className="px-5 py-4 border-b border-bolt-elements-borderColor">
        <h2 className="text-lg font-medium">Importer depuis GitHub</h2>
      </div>
      
      <div className="p-5 space-y-4">
        {/* Message si pas de token */}
        {!githubToken && (
          <div className="p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-md text-yellow-800 dark:text-yellow-400 text-sm mb-4">
            <p>Vous devez configurer un token GitHub API pour importer des dépôts.</p>
            <button 
              onClick={() => setShowTokenConfig(true)}
              className="mt-2 text-blue-600 underline"
            >
              Configurer maintenant
            </button>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">URL du dépôt GitHub</label>
          <input
            type="text"
            className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md text-bolt-elements-textPrimary"
            placeholder="https://github.com/utilisateur/depot"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <p className="text-xs text-bolt-elements-textTertiary mt-1">
            Exemple: https://github.com/utilisateur/depot
          </p>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1">Branche</label>
          <input
            type="text"
            className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md text-bolt-elements-textPrimary"
            placeholder="main"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <p className="text-xs text-bolt-elements-textTertiary mt-1">
            Par défaut: main
          </p>
        </div>
        
        {isLoading && importProgress > 0 && (
          <div className="mt-2">
            <div className="text-sm mb-1">Importation en cours: {importProgress}%</div>
            <div className="w-full h-2 bg-bolt-elements-background-depth-1 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-300" 
                style={{ width: `${importProgress}%` }}
              />
            </div>
          </div>
        )}
        
        {error && (
          <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md text-red-800 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>
      
      <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
        {isLoading ? (
          <DialogButton type="secondary" onClick={onClose}>
            <span className="opacity-50">Annuler</span>
          </DialogButton>
        ) : (
          <DialogButton type="secondary" onClick={onClose}>
            Annuler
          </DialogButton>
        )}
        
        {!repoUrl.trim() || isLoading ? (
          <button className="inline-flex h-[35px] items-center justify-center rounded-lg px-4 text-sm leading-none focus:outline-none bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text opacity-50 cursor-not-allowed">
            {isLoading ? (
              <>
                <div className="i-svg-spinners:3-dots-fade mr-2" />
                Importation...
              </>
            ) : (
              'Importer'
            )}
          </button>
        ) : (
          <DialogButton type="primary" onClick={handleImport}>
            Importer
          </DialogButton>
        )}
      </div>
    </Dialog>
      </DialogRoot>
    </>
  );
};
