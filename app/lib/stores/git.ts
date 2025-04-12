import { atom, map, type MapStore } from 'nanostores';
import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';
import { WORK_DIR } from '~/utils/constants';
import * as nodePath from 'node:path';
import { workbenchStore } from './workbench';
import { toast } from 'react-toastify';

const logger = createScopedLogger('GitStore');

// Types pour Git
export type GitFileStatus = 'modified' | 'untracked' | 'deleted' | 'staged' | 'unmodified';

export interface GitFile {
  path: string;
  status: GitFileStatus;
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitMetadata {
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  lastImported: Date;
}

// Clé localStorage pour stocker les métadonnées du dépôt importé
const GIT_METADATA_KEY = 'bolt_git_metadata';

// Utilitaire pour attendre le résultat d'une commande
async function executeCommand(container: any, command: string[], cwd?: string) {
  const process = await container.spawn(command[0], command.slice(1), cwd ? { cwd } : undefined);
  const exitCode = await process.exit;
  
  let stdout = '';
  process.output.pipeTo(new WritableStream({
    write(data) {
      stdout += data;
    }
  }));
  
  let stderr = '';
  process.stderr.pipeTo(new WritableStream({
    write(data) {
      stderr += data;
    }
  }));
  
  // Attendre que le process se termine
  await process.exit;
  
  return { exit: exitCode, stdout, stderr };
}

export class GitStore {
  // État des fichiers dans le dépôt Git
  files: MapStore<Record<string, GitFile>> = map({});
  
  // État Git courant
  currentBranch = atom<string>('main');
  hasRepo = atom<boolean>(false);
  
  // État du repo
  isBusy = atom<boolean>(false);
  lastError = atom<string | null>(null);
  commits = atom<GitCommit[]>([]);
  remotes = atom<GitRemote[]>([]);
  
  // Métadonnées du dépôt importé
  gitMetadata = atom<GitMetadata | null>(null);
  
  constructor() {
    // Récupérer les métadonnées du localStorage si elles existent
    this.loadGitMetadata();
    
    // Écouter les modifications de fichiers pour mettre à jour l'état Git
    this.setupFileWatcher();
  }
  
  /**
   * Charge les métadonnées Git du localStorage
   */
  private loadGitMetadata() {
    try {
      const storedMetadata = localStorage.getItem(GIT_METADATA_KEY);
      if (storedMetadata) {
        const metadata = JSON.parse(storedMetadata) as GitMetadata;
        this.gitMetadata.set(metadata);
        this.hasRepo.set(true);
        this.currentBranch.set(metadata.branch);
        logger.info('Métadonnées Git chargées:', metadata);
      }
    } catch (error) {
      logger.error('Erreur lors du chargement des métadonnées Git:', error);
    }
  }
  
  /**
   * Sauvegarde les métadonnées Git dans localStorage
   */
  saveGitMetadata(metadata: GitMetadata) {
    try {
      localStorage.setItem(GIT_METADATA_KEY, JSON.stringify(metadata));
      this.gitMetadata.set(metadata);
      this.hasRepo.set(true);
      this.currentBranch.set(metadata.branch);
    } catch (error) {
      logger.error('Erreur lors de la sauvegarde des métadonnées Git:', error);
    }
  }
  
  /**
   * Configure un écouteur pour les modifications de fichiers
   */
  private setupFileWatcher() {
    // Surveiller les changements dans les fichiers pour mettre à jour l'état Git
    workbenchStore.files.listen(() => {
      if (this.hasRepo.get()) {
        this.updateFileStatuses();
      }
    });
  }
  
  /**
   * Initialise un dépôt Git dans le WebContainer
   */
  async initRepo() {
    if (this.isBusy.get()) return;
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Vérifier si git est disponible
      const versionResult = await executeCommand(container, ['git', '--version']);
      if (versionResult.exit !== 0) {
        throw new Error('Git n\'est pas disponible dans le WebContainer');
      }
      
      // Initialiser Git avec les configurations de base
      await executeCommand(container, ['git', 'init'], WORK_DIR);
      await executeCommand(container, ['git', 'config', 'user.name', 'Bolt User'], WORK_DIR);
      await executeCommand(container, ['git', 'config', 'user.email', 'bolt-user@example.com'], WORK_DIR);
      
      // Créer un commit initial si nécessaire
      await executeCommand(container, ['git', 'add', '.'], WORK_DIR);
      await executeCommand(container, ['git', 'commit', '-m', 'Initial commit from Bolt'], WORK_DIR);
      
      // Mettre à jour l'état
      this.hasRepo.set(true);
      this.updateFileStatuses();
      this.loadCommitHistory();
      
      toast.success('Dépôt Git initialisé avec succès');
      logger.info('Dépôt Git initialisé');
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || 'Erreur lors de l\'initialisation du dépôt Git';
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error('Erreur lors de l\'initialisation du dépôt Git:', error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
  
  /**
   * Configure un remote pour le dépôt Git
   */
  async setupRemote(name: string = 'origin', url: string) {
    if (this.isBusy.get()) return false;
    if (!this.hasRepo.get()) {
      const initialized = await this.initRepo();
      if (!initialized) return false;
    }
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Ajouter le remote
      const result = await executeCommand(container, ['git', 'remote', 'add', name, url], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors de l'ajout du remote: ${result.stderr}`);
      }
      
      // Mettre à jour la liste des remotes
      await this.loadRemotes();
      
      toast.success(`Remote '${name}' ajouté avec succès`);
      logger.info(`Remote '${name}' ajouté: ${url}`);
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || `Erreur lors de l'ajout du remote '${name}'`;
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error(`Erreur lors de l'ajout du remote '${name}':`, error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
  
  /**
   * Charge la liste des remotes configurés
   */
  async loadRemotes() {
    if (!this.hasRepo.get()) return;
    
    try {
      const container = await webcontainer;
      
      const result = await executeCommand(container, ['git', 'remote', '-v'], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors du chargement des remotes: ${result.stderr}`);
      }
      
      const output = result.stdout.trim();
      if (!output) {
        this.remotes.set([]);
        return;
      }
      
      // Analyser la sortie pour extraire les remotes
      // Format: "name url (fetch/push)"
      const lines = output.split('\n');
      const remotes: GitRemote[] = [];
      
      for (const line of lines) {
        if (!line.includes('(fetch)')) continue;  // Ignorer les lignes push
        
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          remotes.push({
            name: parts[0],
            url: parts[1]
          });
        }
      }
      
      this.remotes.set(remotes);
      logger.info('Remotes chargés:', remotes);
    } catch (error) {
      logger.error('Erreur lors du chargement des remotes:', error);
    }
  }
  
  /**
   * Met à jour l'état des fichiers dans le dépôt Git
   */
  async updateFileStatuses() {
    if (!this.hasRepo.get()) return;
    
    try {
      const container = await webcontainer;
      
      // Obtenir le statut des fichiers modifiés/non suivis
      const result = await executeCommand(container, ['git', 'status', '--porcelain'], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors de la récupération du statut Git: ${result.stderr}`);
      }
      
      const output = result.stdout.trim();
      const newFiles: Record<string, GitFile> = {};
      
      // Si aucun fichier n'est modifié, la sortie est vide
      if (output) {
        // Analyser la sortie pour déterminer l'état de chaque fichier
        // Format: "XY path"
        // X = statut index (staging), Y = statut working dir
        const lines = output.split('\n');
        
        for (const line of lines) {
          if (line.length < 3) continue;
          
          const statusCode = line.substring(0, 2);
          const filePath = line.substring(3).trim();
          const fullPath = `${WORK_DIR}/${filePath}`;
          
          let status: GitFileStatus = 'unmodified';
          let staged = false;
          
          // Déterminer le statut selon les codes
          const indexStatus = statusCode[0];
          const workdirStatus = statusCode[1];
          
          if (indexStatus !== ' ') {
            staged = true;
            
            if (indexStatus === 'A') status = 'untracked';
            else if (indexStatus === 'M') status = 'modified';
            else if (indexStatus === 'D') status = 'deleted';
          }
          
          if (!staged && workdirStatus !== ' ') {
            if (workdirStatus === '?') status = 'untracked';
            else if (workdirStatus === 'M') status = 'modified';
            else if (workdirStatus === 'D') status = 'deleted';
          }
          
          newFiles[fullPath] = {
            path: fullPath,
            status,
            staged
          };
        }
      }
      
      this.files.set(newFiles);
      logger.info('Statut des fichiers Git mis à jour:', newFiles);
    } catch (error) {
      logger.error('Erreur lors de la mise à jour du statut des fichiers:', error);
    }
  }
  
  /**
   * Charge l'historique des commits
   */
  async loadCommitHistory(maxCount: number = 10) {
    if (!this.hasRepo.get()) return;
    
    try {
      const container = await webcontainer;
      
      // Format: hash, author, date, message
      const format = '%H%n%an%n%aI%n%s';
      const result = await executeCommand(
        container, 
        ['git', 'log', `--max-count=${maxCount}`, `--pretty=format:${format}`, '--date=iso-strict'],
        WORK_DIR
      );
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors du chargement de l'historique des commits: ${result.stderr}`);
      }
      
      const output = result.stdout.trim();
      if (!output) {
        this.commits.set([]);
        return;
      }
      
      // Chaque commit est séparé par un saut de ligne
      const commitBlocks = output.split('\n\n');
      const commits: GitCommit[] = [];
      
      for (const block of commitBlocks) {
        const lines = block.split('\n');
        if (lines.length >= 4) {
          commits.push({
            hash: lines[0],
            author: lines[1],
            date: new Date(lines[2]),
            message: lines[3]
          });
        }
      }
      
      this.commits.set(commits);
      logger.info('Historique des commits chargé:', commits);
    } catch (error) {
      logger.error('Erreur lors du chargement de l\'historique des commits:', error);
    }
  }
  
  /**
   * Stage (ajoute à l'index) un fichier 
   */
  async stageFile(filePath: string) {
    if (this.isBusy.get()) return false;
    if (!this.hasRepo.get()) return false;
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Obtenir le chemin relatif
      const relativePath = nodePath.relative(WORK_DIR, filePath);
      
      // Ajouter le fichier à l'index
      const result = await executeCommand(container, ['git', 'add', relativePath], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors de l'ajout du fichier à l'index: ${result.stderr}`);
      }
      
      // Mettre à jour le statut
      await this.updateFileStatuses();
      
      toast.success(`Fichier '${relativePath}' ajouté à l'index`);
      logger.info(`Fichier stagé: ${filePath}`);
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || `Erreur lors de l'ajout du fichier à l'index`;
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error(`Erreur lors de l'ajout du fichier à l'index:`, error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
  
  /**
   * Unstage (retire de l'index) un fichier
   */
  async unstageFile(filePath: string) {
    if (this.isBusy.get()) return false;
    if (!this.hasRepo.get()) return false;
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Obtenir le chemin relatif
      const relativePath = nodePath.relative(WORK_DIR, filePath);
      
      // Retirer le fichier de l'index
      const result = await executeCommand(container, ['git', 'reset', 'HEAD', relativePath], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors du retrait du fichier de l'index: ${result.stderr}`);
      }
      
      // Mettre à jour le statut
      await this.updateFileStatuses();
      
      toast.success(`Fichier '${relativePath}' retiré de l'index`);
      logger.info(`Fichier unstagé: ${filePath}`);
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || `Erreur lors du retrait du fichier de l'index`;
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error(`Erreur lors du retrait du fichier de l'index:`, error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
  
  /**
   * Crée un commit avec les fichiers stagés
   */
  async commit(message: string) {
    if (this.isBusy.get()) return false;
    if (!this.hasRepo.get()) return false;
    if (!message.trim()) {
      toast.error('Le message de commit ne peut pas être vide');
      return false;
    }
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Créer le commit
      const result = await executeCommand(container, ['git', 'commit', '-m', message], WORK_DIR);
      
      if (result.exit !== 0) {
        // Si l'erreur est "nothing to commit", ce n'est pas une erreur grave
        if (result.stderr.includes('nothing to commit')) {
          toast.info('Aucun fichier à commiter');
          return false;
        }
        
        throw new Error(`Erreur lors de la création du commit: ${result.stderr}`);
      }
      
      // Mettre à jour le statut et l'historique
      await this.updateFileStatuses();
      await this.loadCommitHistory();
      
      toast.success(`Commit créé avec succès`);
      logger.info(`Commit créé: ${message}`);
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || `Erreur lors de la création du commit`;
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error(`Erreur lors de la création du commit:`, error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
  
  /**
   * Pousse les changements vers le dépôt distant
   */
  async push(remote: string = 'origin', branch: string = '') {
    if (this.isBusy.get()) return false;
    if (!this.hasRepo.get()) return false;
    
    // Si branch n'est pas spécifié, utiliser la branche courante
    const targetBranch = branch || this.currentBranch.get();
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Pousser les changements
      const result = await executeCommand(container, ['git', 'push', remote, targetBranch], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors du push: ${result.stderr}`);
      }
      
      toast.success(`Changements poussés avec succès vers ${remote}/${targetBranch}`);
      logger.info(`Push réussi: ${remote}/${targetBranch}`);
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || `Erreur lors du push`;
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error(`Erreur lors du push:`, error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
  
  /**
   * Tire les changements depuis le dépôt distant
   */
  async pull(remote: string = 'origin', branch: string = '') {
    if (this.isBusy.get()) return false;
    if (!this.hasRepo.get()) return false;
    
    // Si branch n'est pas spécifié, utiliser la branche courante
    const targetBranch = branch || this.currentBranch.get();
    
    this.isBusy.set(true);
    this.lastError.set(null);
    
    try {
      const container = await webcontainer;
      
      // Tirer les changements
      const result = await executeCommand(container, ['git', 'pull', remote, targetBranch], WORK_DIR);
      
      if (result.exit !== 0) {
        throw new Error(`Erreur lors du pull: ${result.stderr}`);
      }
      
      // Mettre à jour l'état
      await this.updateFileStatuses();
      await this.loadCommitHistory();
      
      toast.success(`Changements tirés avec succès depuis ${remote}/${targetBranch}`);
      logger.info(`Pull réussi: ${remote}/${targetBranch}`);
      
      // Recharger les fichiers pour refléter les changements
      const workbenchFiles = workbenchStore.files.get();
      workbenchStore.setDocuments(workbenchFiles);
      
      return true;
    } catch (error: any) {
      const errorMessage = error.message || `Erreur lors du pull`;
      this.lastError.set(errorMessage);
      toast.error(errorMessage);
      logger.error(`Erreur lors du pull:`, error);
      return false;
    } finally {
      this.isBusy.set(false);
    }
  }
}

// Exporter une instance singleton
export const gitStore = new GitStore();
