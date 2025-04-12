import type { PathWatcherEvent, WebContainer } from '@webcontainer/api';
import { getEncoding } from 'istextorbinary';
import { map, type MapStore } from 'nanostores';
import { Buffer } from 'node:buffer';
import * as nodePath from 'node:path';
import { bufferWatchEvents } from '~/utils/buffer';
import { WORK_DIR } from '~/utils/constants';
import { computeFileModifications } from '~/utils/diff';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';

const logger = createScopedLogger('FilesStore');

const utf8TextDecoder = new TextDecoder('utf8', { fatal: true });

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export class FilesStore {
  #webcontainer: Promise<WebContainer>;

  /**
   * Tracks the number of files without folders.
   */
  #size = 0;

  /**
   * @note Keeps track all modified files with their original content since the last user message.
   * Needs to be reset when the user sends another message and all changes have to be submitted
   * for the model to be aware of the changes.
   */
  #modifiedFiles: Map<string, string> = import.meta.hot?.data.modifiedFiles ?? new Map();

  /**
   * Map of files that matches the state of WebContainer.
   */
  files: MapStore<FileMap> = import.meta.hot?.data.files ?? map({});

  get filesCount() {
    return this.#size;
  }

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.files = this.files;
      import.meta.hot.data.modifiedFiles = this.#modifiedFiles;
    }

    this.#init();
  }

  getFile(filePath: string) {
    const dirent = this.files.get()[filePath];

    if (dirent?.type !== 'file') {
      return undefined;
    }

    return dirent;
  }

  getFileModifications() {
    return computeFileModifications(this.files.get(), this.#modifiedFiles);
  }

  resetFileModifications() {
    this.#modifiedFiles.clear();
  }

  async saveFile(filePath: string, content: string) {
    const webcontainer = await this.#webcontainer;

    try {
      const relativePath = nodePath.relative(webcontainer.workdir, filePath);

      if (!relativePath) {
        throw new Error(`EINVAL: invalid file path, write '${relativePath}'`);
      }

      const oldContent = this.getFile(filePath)?.content;

      if (!oldContent) {
        unreachable('Expected content to be defined');
      }

      await webcontainer.fs.writeFile(relativePath, content);

      if (!this.#modifiedFiles.has(filePath)) {
        this.#modifiedFiles.set(filePath, oldContent);
      }

      // we immediately update the file and don't rely on the `change` event coming from the watcher
      this.files.setKey(filePath, { type: 'file', content, isBinary: false });

      logger.info('File updated');
    } catch (error) {
      logger.error('Failed to update file content\n\n', error);

      throw error;
    }
  }

  /**
   * Supprime un fichier du WebContainer et met à jour le store.
   * @param filePath Le chemin absolu du fichier à supprimer.
   * @returns Promise qui se résout quand le fichier est supprimé.
   */
  async deleteFile(filePath: string) {
    const webcontainer = await this.#webcontainer;

    try {
      const relativePath = nodePath.relative(webcontainer.workdir, filePath);

      if (!relativePath) {
        throw new Error(`EINVAL: invalid file path, delete '${relativePath}'`);
      }

      // Vérifier que le fichier existe
      const file = this.getFile(filePath);
      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Supprimer le fichier du système de fichiers
      await webcontainer.fs.rm(relativePath);

      // Mettre à jour le store immédiatement pour une réactivité instantanée
      // Normalement, le watcher détectera le changement, mais pour plus de réactivité,
      // nous mettons à jour immédiatement
      this.files.setKey(filePath, undefined);
      this.#size--;

      // Nettoyer les fichiers modifiés
      this.#modifiedFiles.delete(filePath);

      logger.info(`File deleted: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to delete file: ${filePath}\n\n`, error);
      throw error;
    }
  }

  /**
   * Imports a file into the WebContainer and updates the store.
   * @param filePath The absolute path where the file should be created.
   * @param content The file content as a Uint8Array.
   */
  async importFile(filePath: string, content: Uint8Array) {
    const webcontainer = await this.#webcontainer;
    const relativePath = nodePath.relative(webcontainer.workdir, filePath);

    if (!relativePath || relativePath.startsWith('..')) {
      logger.error(`Invalid import path: ${filePath}`);
      throw new Error(`Invalid import path: ${filePath}`);
    }

    try {
      // Ensure parent directory exists
      const dirname = nodePath.dirname(relativePath);
      if (dirname !== '.') {
        // The recursive option handles cases where multiple levels need creation.
        await webcontainer.fs.mkdir(dirname, { recursive: true });
        // Update store for potentially created directories (watcher might be slow)
        let currentPath = '';
        for (const part of dirname.split(nodePath.sep)) {
          currentPath = nodePath.join(currentPath, part);
          const fullPath = nodePath.join(webcontainer.workdir, currentPath);
          if (!this.files.get()[fullPath]) {
             this.files.setKey(fullPath, { type: 'folder' });
             logger.info(`Implicitly created folder in store: ${fullPath}`);
          }
        }
      }

      // Write the file content
      await webcontainer.fs.writeFile(relativePath, content);

      // Determine if binary and decode if necessary
      const isBinary = isBinaryFile(content);
      const decodedContent = isBinary ? '' : this.#decodeFileContent(content);

      // Update the store immediately
      // Check if file already existed (replace scenario)
      if (!this.files.get()[filePath]) {
        this.#size++; // Increment size only for new files
      }
      this.files.setKey(filePath, { type: 'file', content: decodedContent, isBinary });

      logger.info(`File imported successfully: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to import file ${filePath}\n\n`, error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }

  async #init() {
    const webcontainer = await this.#webcontainer;

    webcontainer.internal.watchPaths(
      { include: [`${WORK_DIR}/**`], exclude: ['**/node_modules', '.git'], includeContent: true },
      bufferWatchEvents(100, this.#processEventBuffer.bind(this)),
    );
  }

  #processEventBuffer(events: Array<[events: PathWatcherEvent[]]>) {
    const watchEvents = events.flat(2);

    for (const { type, path, buffer } of watchEvents) {
      // remove any trailing slashes
      const sanitizedPath = path.replace(/\/+$/g, '');

      switch (type) {
        case 'add_dir': {
          // we intentionally add a trailing slash so we can distinguish files from folders in the file tree
          this.files.setKey(sanitizedPath, { type: 'folder' });
          break;
        }
        case 'remove_dir': {
          this.files.setKey(sanitizedPath, undefined);

          for (const [direntPath] of Object.entries(this.files)) {
            if (direntPath.startsWith(sanitizedPath)) {
              this.files.setKey(direntPath, undefined);
            }
          }

          break;
        }
        case 'add_file':
        case 'change': {
          if (type === 'add_file') {
            this.#size++;
          }

          let content = '';

          /**
           * @note This check is purely for the editor. The way we detect this is not
           * bullet-proof and it's a best guess so there might be false-positives.
           * The reason we do this is because we don't want to display binary files
           * in the editor nor allow to edit them.
           */
          const isBinary = isBinaryFile(buffer);

          if (!isBinary) {
            content = this.#decodeFileContent(buffer);
          }

          this.files.setKey(sanitizedPath, { type: 'file', content, isBinary });

          break;
        }
        case 'remove_file': {
          this.#size--;
          this.files.setKey(sanitizedPath, undefined);
          break;
        }
        case 'update_directory': {
          // we don't care about these events
          break;
        }
      }
    }
  }

  #decodeFileContent(buffer?: Uint8Array) {
    if (!buffer || buffer.byteLength === 0) {
      return '';
    }

    try {
      return utf8TextDecoder.decode(buffer);
    } catch (error) {
      console.log(error);
      return '';
    }
  }
}

function isBinaryFile(buffer: Uint8Array | undefined) {
  if (buffer === undefined) {
    return false;
  }

  return getEncoding(convertToBuffer(buffer), { chunkLength: 100 }) === 'binary';
}

/**
 * Converts a `Uint8Array` into a Node.js `Buffer` by copying the prototype.
 * The goal is to  avoid expensive copies. It does create a new typed array
 * but that's generally cheap as long as it uses the same underlying
 * array buffer.
 */
function convertToBuffer(view: Uint8Array): Buffer {
  // Create a proper Buffer instance from the Uint8Array's underlying ArrayBuffer.
  // This is safer than manipulating prototypes.
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}
