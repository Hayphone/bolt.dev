import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';

// Type pour les fichiers copiés/coupés
interface CopiedFile {
  path: string;
  operation: 'copy' | 'cut';
}
import * as nodePath from 'node:path';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('WorkbenchStore');
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { webcontainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';

export interface ArtifactState {
  id: string;
  title: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'preview' | 'git';

export class WorkbenchStore {
  #previewsStore = new PreviewsStore(webcontainer);
  #filesStore = new FilesStore(webcontainer);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(webcontainer);

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});
  
  // État pour le fichier copié/coupé
  copiedFile: WritableAtom<CopiedFile | null> = import.meta.hot?.data.copiedFile ?? atom<CopiedFile | null>(null);

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];

  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
    }
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      // we find the first file and select it
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();

    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();

      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) {
        return;
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles);

      if (unsavedChanges) {
        newUnsavedFiles.add(currentDocument.filePath);
      } else {
        newUnsavedFiles.delete(currentDocument.filePath);
      }

      this.unsavedFiles.set(newUnsavedFiles);
    }
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  /**
   * Imports a file into the WebContainer via the FilesStore.
   * @param filePath The absolute path where the file should be created.
   * @param content The file content as a Uint8Array.
   */
  async importFile(filePath: string, content: Uint8Array) {
    // Delegate to the FilesStore's importFile method
    await this.#filesStore.importFile(filePath, content);
  }

  /**
   * Supprime un fichier et met à jour l'interface utilisateur en conséquence.
   * @param filePath Le chemin absolu du fichier à supprimer.
   * @returns Promise qui se résout quand le fichier est supprimé.
   */
  async deleteFile(filePath: string) {
    try {
      // Vérifier si le fichier supprimé est actuellement sélectionné
      const currentSelectedFile = this.selectedFile.get();
      
      // Supprimer le fichier via FilesStore
      await this.#filesStore.deleteFile(filePath);
      
      // Si le fichier supprimé était celui sélectionné, trouver un autre fichier à sélectionner
      if (currentSelectedFile === filePath) {
        const files = this.files.get();
        let nextFile: string | undefined;
        
        // Chercher le premier fichier disponible
        for (const [path, dirent] of Object.entries(files)) {
          if (dirent?.type === 'file') {
            nextFile = path;
            break;
          }
        }
        
        // Sélectionner le nouveau fichier ou rien s'il n'y en a pas
        this.setSelectedFile(nextFile);
      }
      
      // Nettoyer les références au fichier supprimé dans unsavedFiles
      const unsaved = this.unsavedFiles.get();
      if (unsaved.has(filePath)) {
        const newUnsaved = new Set(unsaved);
        newUnsaved.delete(filePath);
        this.unsavedFiles.set(newUnsaved);
      }
      
    } catch (error) {
      console.error(`Erreur lors de la suppression du fichier ${filePath}:`, error);
      throw error;
    }
  }

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  addArtifact({ messageId, title, id }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      runner: new ActionRunner(webcontainer),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }

  async addAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    artifact.runner.addAction(data);
  }

  async runAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    artifact.runner.runAction(data);
  }

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }
  
  /**
   * Définit un fichier comme étant copié ou coupé.
   * @param path Le chemin du fichier
   * @param operation Le type d'opération (copy ou cut)
   */
  setCopiedFile(path: string, operation: 'copy' | 'cut') {
    this.copiedFile.set({ path, operation });
  }
  
  /**
   * Vérifie si un fichier a été copié ou coupé.
   * @returns true si un fichier est en attente de collage
   */
  hasCopiedFile(): boolean {
    return this.copiedFile.get() !== null;
  }
  
  /**
   * Colle le fichier précédemment copié ou coupé dans le dossier spécifié.
   * @param targetFolder Le dossier de destination
   * @returns Promise qui se résout quand l'opération est terminée
   */
  async pasteFile(targetFolder: string): Promise<void> {
    const copied = this.copiedFile.get();
    if (!copied) return;
    
    // Obtenir le nom du fichier
    const fileName = copied.path.split('/').pop() || '';
    const newPath = `${targetFolder}/${fileName}`;
    
    // Vérifier si c'est le même chemin
    if (copied.path === newPath) return;
    
    try {
      // Lire le contenu du fichier source
      const file = this.#filesStore.getFile(copied.path);
      if (!file) {
        throw new Error(`Fichier source introuvable: ${copied.path}`);
      }
      
      // Écrire au nouvel emplacement
      await this.#filesStore.saveFile(newPath, file.content);
      
      // Si c'était une coupure, supprimer l'original
      if (copied.operation === 'cut') {
        await this.deleteFile(copied.path);
      }
      
      // Réinitialiser
      this.copiedFile.set(null);
    } catch (error) {
      console.error(`Erreur lors du collage du fichier:`, error);
      throw error;
    }
  }
  
  /**
   * Renomme un fichier.
   * @param oldPath Chemin actuel du fichier
   * @param newName Nouveau nom du fichier (sans le chemin)
   * @returns Promise qui se résout quand le fichier est renommé
   */
  async renameFile(oldPath: string, newName: string): Promise<void> {
    try {
      // Obtenir le répertoire parent
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = `${parentDir}/${newName}`;
      
      // Vérifier si c'est le même chemin
      if (oldPath === newPath) return;
      
      // Lire le contenu du fichier source
      const file = this.#filesStore.getFile(oldPath);
      if (!file) {
        throw new Error(`Fichier source introuvable: ${oldPath}`);
      }
      
      // Écrire sous le nouveau nom
      await this.#filesStore.saveFile(newPath, file.content);
      
      // Supprimer l'ancien fichier
      await this.deleteFile(oldPath);
      
      // Sélectionner le fichier renommé
      this.setSelectedFile(newPath);
    } catch (error) {
      console.error(`Erreur lors du renommage du fichier:`, error);
      throw error;
    }
  }
  /**
   * Crée un nouveau fichier avec le contenu spécifié.
   * @param filePath Le chemin absolu où créer le fichier
   * @param content Le contenu du fichier (peut être vide)
   * @returns Promise qui se résout quand le fichier est créé
   */
  async createFile(filePath: string, content: Uint8Array): Promise<void> {
    try {
      await this.#filesStore.saveFile(filePath, new TextDecoder().decode(content));
    } catch (error) {
      console.error(`Erreur lors de la création du fichier ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Crée un nouveau dossier.
   * @param folderPath Le chemin absolu où créer le dossier
   * @returns Promise qui se résout quand le dossier est créé
   */
  async createFolder(folderPath: string): Promise<void> {
    try {
      const webContainer = await webcontainer;
      const relativePath = nodePath.relative(webContainer.workdir, folderPath);
      
      if (!relativePath) {
        throw new Error(`EINVAL: invalid folder path, create '${relativePath}'`);
      }
      
      // Créer le dossier avec l'option recursive (pour créer les dossiers parents si nécessaire)
      await webContainer.fs.mkdir(relativePath, { recursive: true });
      
      // Mettre à jour le store manuellement (normalement le watcher le fera, mais pour plus de réactivité)
      this.files.setKey(folderPath, { type: 'folder' });
      
      logger.info(`Folder created: ${folderPath}`);
    } catch (error) {
      console.error(`Erreur lors de la création du dossier ${folderPath}:`, error);
      throw error;
    }
  }
  
  /**
   * Lit le contenu d'un fichier.
   * @param filePath Le chemin absolu du fichier à lire
   * @returns Promise qui se résout avec le contenu du fichier
   */
  async readFile(filePath: string): Promise<Uint8Array | null> {
    try {
      const file = this.#filesStore.getFile(filePath);
      if (!file) {
        return null;
      }
      return new TextEncoder().encode(file.content);
    } catch (error) {
      console.error(`Erreur lors de la lecture du fichier ${filePath}:`, error);
      throw error;
    }
  }
}

export const workbenchStore = new WorkbenchStore();
