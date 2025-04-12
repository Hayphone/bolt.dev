import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { FileMap } from '~/lib/stores/files';
import type { ChatHistoryItem } from './useChatHistory';

const logger = createScopedLogger('Persistence');

// Interface représentant un projet sauvegardé
export interface ProjectItem {
  id: string;            // ID unique du projet
  name: string;          // Nom du projet
  files: FileMap;        // Structure et contenu des fichiers
  timestamp: string;     // Date de sauvegarde
  description?: string;  // Description optionnelle
}

// this is used at the top level and never rejects
// Fonction qui vérifie si une base de données existe déjà
async function checkDatabaseExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const databases = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
    databases.then((dbs) => {
      const exists = dbs.some((db) => db.name === name);
      resolve(exists);
    }).catch(() => {
      // Si l'API databases() n'est pas supportée ou échoue
      resolve(false);
    });
  });
}

export async function openDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise(async (resolve) => {
    // Nom de la base de données principal et celui potentiellement utilisé avec un port différent
    const mainDbName = 'boltHistory';
    const portSpecificDbName = `boltHistory_${window.location.port}`;
    
    // Vérifier si nous avons une base de données spécifique au port
    const hasPortDb = await checkDatabaseExists(portSpecificDbName);
    
    // Si une base spécifique au port existe, l'utiliser
    const dbNameToUse = hasPortDb ? portSpecificDbName : mainDbName;
    
    // On passe à la version 2 pour ajouter le store 'projects'
    const request = indexedDB.open(dbNameToUse, 2);
    
    // Log pour déboguer
    logger.info(`Utilisation de la base de données: ${dbNameToUse}`);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // Création du store 'chats' si c'est une nouvelle base
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('urlId', 'urlId', { unique: true });
        }
      }
      
      // Ajout du store 'projects' pour la version 2
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('projects')) {
          const projectsStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectsStore.createIndex('id', 'id', { unique: true });
          projectsStore.createIndex('name', 'name', { unique: false });
          projectsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function getAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ChatHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');

    const request = store.put({
      id,
      messages,
      urlId,
      description,
      timestamp: new Date().toISOString(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getMessages(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id));
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');
    const request = store.delete(id);

    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getNextId(db: IDBDatabase, storeName: 'chats' | 'projects' = 'chats'): Promise<string> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const highestId = request.result.reduce((cur, acc) => Math.max(+cur, +acc), 0);
      resolve(String(+highestId + 1));
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getUrlId(db: IDBDatabase, id: string): Promise<string> {
  const idList = await getUrlIds(db);

  if (!idList.includes(id)) {
    return id;
  } else {
    let i = 2;

    while (idList.includes(`${id}-${i}`)) {
      i++;
    }

    return `${id}-${i}`;
  }
}

async function getUrlIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// ------ Fonctions de gestion des projets ------

// Récupérer tous les projets sauvegardés
export async function getAllProjects(db: IDBDatabase): Promise<ProjectItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readonly');
    const store = transaction.objectStore('projects');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ProjectItem[]);
    request.onerror = () => reject(request.error);
  });
}

// Récupérer un projet par son ID
export async function getProject(db: IDBDatabase, id: string): Promise<ProjectItem | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readonly');
    const store = transaction.objectStore('projects');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ProjectItem);
    request.onerror = () => reject(request.error);
  });
}

// Sauvegarder un projet
export async function saveProject(
  db: IDBDatabase,
  name: string,
  files: FileMap,
  description?: string,
  existingId?: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      // Nettoyer et filtrer les fichiers volumineux pour éviter les erreurs IndexedDB
      const cleanedFiles: FileMap = {};
      
      // Traiter chaque fichier pour éviter les problèmes de taille
      for (const [path, dirent] of Object.entries(files)) {
        if (!dirent) continue;
        
        try {
          if (dirent.type === 'file') {
            // Limiter la taille des fichiers texte
            if (!dirent.isBinary && dirent.content.length > 1000000) {
              // Tronquer les fichiers volumineux
              cleanedFiles[path] = {
                ...dirent,
                content: dirent.content.substring(0, 500000) + "\n[... Contenu tronqué pour la sauvegarde ...]"
              };
              logger.warn(`Fichier tronqué pour la sauvegarde: ${path}`);
              continue;
            }
            
            // Pour les fichiers binaires, stocker uniquement les métadonnées
            if (dirent.isBinary) {
              cleanedFiles[path] = {
                ...dirent,
                content: "" // Vider le contenu des fichiers binaires
              };
              continue;
            }
          }
          
          // Ajouter le fichier ou dossier normal
          cleanedFiles[path] = dirent;
        } catch (error) {
          logger.error(`Erreur lors du traitement du fichier ${path}:`, error);
          // Continuer avec les autres fichiers
        }
      }
      
      const transaction = db.transaction('projects', 'readwrite');
      const store = transaction.objectStore('projects');
      
      // Utiliser l'ID existant ou en générer un nouveau
      const id = existingId || await getNextId(db, 'projects');
      
      const projectItem: ProjectItem = {
        id,
        name,
        files: cleanedFiles,
        description,
        timestamp: new Date().toISOString(),
      };
      
      const request = store.put(projectItem);
      
      request.onsuccess = () => resolve(id);
      request.onerror = (event) => {
        logger.error('Erreur lors de la sauvegarde dans IndexedDB:', request.error);
        logger.error('Détails de l\'erreur:', event);
        
        // Essayer avec encore moins de fichiers si l'erreur persiste
        if (Object.keys(cleanedFiles).length > 50) {
          logger.warn('Tentative de sauvegarde avec moins de fichiers');
          
          // Créer un objet avec seulement les 50 premiers fichiers
          const reducedFiles: FileMap = {};
          let count = 0;
          
          for (const [path, dirent] of Object.entries(cleanedFiles)) {
            if (count >= 50) break;
            reducedFiles[path] = dirent;
            count++;
          }
          
          const request2 = store.put({
            ...projectItem,
            files: reducedFiles,
            description: (description || '') + ' [Sauvegarde partielle]'
          });
          
          request2.onsuccess = () => resolve(id);
          request2.onerror = () => reject(request2.error);
        } else {
          reject(request.error);
        }
      };
    } catch (error) {
      logger.error('Exception lors de la sauvegarde du projet:', error);
      reject(error);
    }
  });
}

// Supprimer un projet
export async function deleteProject(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    const request = store.delete(id);

    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}
