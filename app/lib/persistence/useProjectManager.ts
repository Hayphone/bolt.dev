import { useState, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import type { FileMap } from '~/lib/stores/files';
import { webcontainer } from '~/lib/webcontainer';
import { getAllProjects, getProject, saveProject, deleteProject, openDatabase, type ProjectItem } from './db';
import * as nodePath from 'node:path';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ProjectManager');
const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

/**
 * Hook pour gérer la sauvegarde et le chargement des projets
 */
export function useProjectManager() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [db, setDb] = useState<IDBDatabase | undefined>(undefined);
  
  // Initialiser la base de données à la première utilisation
  useEffect(() => {
    async function initDb() {
      if (persistenceEnabled) {
        const database = await openDatabase();
        setDb(database);
        
        if (!database) {
          toast.error('Persistance des projets indisponible');
        }
      }
    }
    
    initDb();
  }, []);
  
  // Charger tous les projets quand la DB est prête
  useEffect(() => {
    if (db) {
      loadAllProjects();
    }
  }, [db]);
  
  /**
   * Récupère tous les projets sauvegardés
   */
  const loadAllProjects = useCallback(async () => {
    if (!db) return;
    
    try {
      setLoading(true);
      const allProjects = await getAllProjects(db);
      setProjects(allProjects.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      );
    } catch (error) {
      logger.error('Erreur lors du chargement des projets:', error);
      toast.error('Erreur lors du chargement des projets');
    } finally {
      setLoading(false);
    }
  }, [db]);
  
  /**
   * Sauvegarde le projet actuel
   * @param name Nom du projet
   * @param description Description optionnelle
   * @param existingId ID du projet existant (pour écrasement)
   */
  const saveCurrentProject = useCallback(async (
    name: string, 
    description?: string,
    existingId?: string
  ): Promise<string | undefined> => {
    if (!db) {
      toast.error('Persistance non disponible');
      return;
    }
    
    try {
      setLoading(true);
      
      // 1. Récupérer l'état actuel des fichiers via workbenchStore
      const currentFiles = workbenchStore.files.get();
      
      // 2. Sauvegarder dans la base de données
      const projectId = await saveProject(db, name, currentFiles, description, existingId);
      
      toast.success('Projet sauvegardé avec succès');
      
      // 3. Rafraîchir la liste des projets
      await loadAllProjects();
      
      return projectId;
    } catch (error) {
      logger.error('Erreur lors de la sauvegarde du projet:', error);
      toast.error('Erreur lors de la sauvegarde du projet');
    } finally {
      setLoading(false);
    }
  }, [db, loadAllProjects]);
  
  /**
   * Charge un projet sauvegardé
   * @param projectId ID du projet à charger
   */
  const loadProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (!db) {
      toast.error('Persistance non disponible');
      return false;
    }
    
    try {
      setLoading(true);
      
      // 1. Récupérer le projet depuis la DB
      const project = await getProject(db, projectId);
      
      if (!project) {
        toast.error('Projet introuvable');
        return false;
      }
      
      // 2. Récupérer l'instance WebContainer
      const webContainerInstance = await webcontainer;
      
      // 3. Effacer le contenu actuel du WebContainer (fichiers et dossiers)
      // On commence par récupérer la liste des fichiers/dossiers à la racine
      const dirEntries = await webContainerInstance.fs.readdir('/');
      
      // Supprimer tous les fichiers et dossiers existants (sauf .env, etc. si besoin)
      for (const entry of dirEntries) {
        // On pourrait exclure certains fichiers/dossiers si nécessaire
        try {
          await webContainerInstance.fs.rm(entry, { recursive: true, force: true });
        } catch (error) {
          logger.error(`Erreur lors de la suppression de ${entry}:`, error);
        }
      }
      
      // 4. Recréer l'arborescence à partir des fichiers sauvegardés
      for (const [path, dirent] of Object.entries(project.files)) {
        if (!dirent) continue;
        
        const relativePath = path.startsWith('/') ? path.slice(1) : path;
        
        try {
          if (dirent.type === 'folder') {
            // Créer le dossier
            await webContainerInstance.fs.mkdir(relativePath, { recursive: true });
          } else if (dirent.type === 'file') {
            // Créer le dossier parent si nécessaire
            const dirPath = nodePath.dirname(relativePath);
            if (dirPath !== '.') {
              await webContainerInstance.fs.mkdir(dirPath, { recursive: true });
            }
            
            // Écrire le fichier (binaire ou texte)
            await webContainerInstance.fs.writeFile(
              relativePath, 
              dirent.isBinary ? new Uint8Array(0) : dirent.content
            );
          }
        } catch (error) {
          logger.error(`Erreur lors de la restauration de ${path}:`, error);
        }
      }
      
      toast.success(`Projet "${project.name}" chargé avec succès`);
      return true;
    } catch (error) {
      logger.error('Erreur lors du chargement du projet:', error);
      toast.error('Erreur lors du chargement du projet');
      return false;
    } finally {
      setLoading(false);
    }
  }, [db]);
  
  /**
   * Supprime un projet
   * @param projectId ID du projet à supprimer
   */
  const removeProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (!db) {
      toast.error('Persistance non disponible');
      return false;
    }
    
    try {
      setLoading(true);
      
      // Vérifier que le projet existe
      const project = await getProject(db, projectId);
      
      if (!project) {
        toast.error('Projet introuvable');
        return false;
      }
      
      // Supprimer le projet
      await deleteProject(db, projectId);
      
      toast.success('Projet supprimé');
      
      // Rafraîchir la liste
      await loadAllProjects();
      
      return true;
    } catch (error) {
      logger.error('Erreur lors de la suppression du projet:', error);
      toast.error('Erreur lors de la suppression du projet');
      return false;
    } finally {
      setLoading(false);
    }
  }, [db, loadAllProjects]);
  
  return {
    projects,
    loading,
    loadAllProjects,
    saveCurrentProject,
    loadProject,
    removeProject,
    isAvailable: !!db && persistenceEnabled
  };
}
