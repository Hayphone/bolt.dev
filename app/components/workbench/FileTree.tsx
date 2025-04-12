import { memo, useEffect, useMemo, useRef, useState, createContext, useContext, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
import type { SetStateAction, Dispatch } from 'react';
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from '../ui/ContextMenu';
import { workbenchStore } from '~/lib/stores/workbench';
import type { FileMap } from '~/lib/stores/files';
import { classNames } from '~/utils/classNames';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { IconButton } from '../ui/IconButton';
import * as nodePath from 'node:path';
import { WORK_DIR } from '~/utils/constants';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { toast } from 'react-toastify';

const logger = createScopedLogger('FileTree');

const NODE_PADDING_LEFT = 8;
const DEFAULT_HIDDEN_FILES = [/\/node_modules\//, /\/\.next/, /\/\.astro/];

interface Props {
  files?: FileMap;
  selectedFile?: string;
  onFileSelect?: (filePath: string) => void;
  rootFolder?: string;
  hideRoot?: boolean;
  collapsed?: boolean;
  allowFolderSelection?: boolean;
  hiddenFiles?: Array<string | RegExp>;
  unsavedFiles?: Set<string>;
  className?: string;
}

export const FileTree = memo(
  ({
    files = {},
    onFileSelect,
    selectedFile,
    rootFolder,
    hideRoot = false,
    collapsed = false,
    allowFolderSelection = false,
    hiddenFiles,
    className,
    unsavedFiles,
  }: Props) => {
    renderLogger.trace('FileTree');

    const fileInputRef = useRef<HTMLInputElement>(null); // Ref for hidden file input
    const [fileToDelete, setFileToDelete] = useState<FileNode | null>(null);
    const [fileToRename, setFileToRename] = useState<FileNode | null>(null);
    const [newFileName, setNewFileName] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [showNewFileDialog, setShowNewFileDialog] = useState(false);  
    const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
    const [currentPath, setCurrentPath] = useState('/');
    
    // État pour le menu contextuel
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      node: FileNode | FolderNode;
    } | null>(null);
    
    // Configurer l'écouteur d'événements pour le menu contextuel via événements personnalisés
    useEffect(() => {
      const handleContextMenuEvent = (e: Event) => {
        const customEvent = e as CustomEvent;
        const { x, y, node } = customEvent.detail;
        setContextMenu({ x, y, node });
      };
      
      document.addEventListener('filetree:contextmenu', handleContextMenuEvent);
      
      return () => {
        document.removeEventListener('filetree:contextmenu', handleContextMenuEvent);
      };
    }, []);

    const computedHiddenFiles = useMemo(() => [...DEFAULT_HIDDEN_FILES, ...(hiddenFiles ?? [])], [hiddenFiles]);

    const fileList = useMemo(() => {
      return buildFileList(files, rootFolder, hideRoot, computedHiddenFiles);
    }, [files, rootFolder, hideRoot, computedHiddenFiles]);

    const [collapsedFolders, setCollapsedFolders] = useState(() => {
      return collapsed
        ? new Set(fileList.filter((item) => item.kind === 'folder').map((item) => item.fullPath))
        : new Set<string>();
    });

    useEffect(() => {
      if (collapsed) {
        setCollapsedFolders(new Set(fileList.filter((item) => item.kind === 'folder').map((item) => item.fullPath)));
        return;
      }

      setCollapsedFolders((prevCollapsed) => {
        const newCollapsed = new Set<string>();

        for (const folder of fileList) {
          if (folder.kind === 'folder' && prevCollapsed.has(folder.fullPath)) {
            newCollapsed.add(folder.fullPath);
          }
        }

        return newCollapsed;
      });
    }, [fileList, collapsed]);

    const filteredFileList = useMemo(() => {
      const list = [];

      let lastDepth = Number.MAX_SAFE_INTEGER;

      for (const fileOrFolder of fileList) {
        const depth = fileOrFolder.depth;

        // if the depth is equal we reached the end of the collaped group
        if (lastDepth === depth) {
          lastDepth = Number.MAX_SAFE_INTEGER;
        }

        // ignore collapsed folders
        if (collapsedFolders.has(fileOrFolder.fullPath)) {
          lastDepth = Math.min(lastDepth, depth);
        }

        // ignore files and folders below the last collapsed folder
        if (lastDepth < depth) {
          continue;
        }

        list.push(fileOrFolder);
      }

      return list;
    }, [fileList, collapsedFolders]);

    const toggleCollapseState = (fullPath: string) => {
      setCollapsedFolders((prevSet) => {
        const newSet = new Set(prevSet);

        if (newSet.has(fullPath)) {
          newSet.delete(fullPath);
        } else {
          newSet.add(fullPath);
        }

        return newSet;
      });
    };

    // Handler for file deletion
    const handleDeleteFile = async () => {
      if (!fileToDelete) return;
      
      try {
        await workbenchStore.deleteFile(fileToDelete.fullPath);
        toast.success(`Fichier "${fileToDelete.name}" supprimé`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(`Erreur lors de la suppression: ${errorMessage}`);
        logger.error('Erreur de suppression:', error);
      } finally {
        setFileToDelete(null);
      }
    };
    
    // Handler for file renaming
    const handleRenameFile = async () => {
      if (!fileToRename || !newFileName.trim()) return;
      
      try {
        await workbenchStore.renameFile(fileToRename.fullPath, newFileName);
        toast.success(`Fichier renommé en "${newFileName}"`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(`Erreur lors du renommage: ${errorMessage}`);
        logger.error('Erreur de renommage:', error);
      } finally {
        setFileToRename(null);
        setNewFileName('');
      }
    };

    // Handler for triggering the file input click
    const handleImportClick = () => {
      fileInputRef.current?.click();
    };

    // Handler for creating a new file
    const handleNewFile = async () => {
      if (!newFileName.trim()) {
        toast.error("Veuillez entrer un nom de fichier valide");
        return;
      }
      
      try {
        const filePath = nodePath.join(currentPath, newFileName);
        // Contenu vide par défaut
        await workbenchStore.createFile(filePath, new Uint8Array([]));
        toast.success(`Fichier "${newFileName}" créé avec succès`);
        setShowNewFileDialog(false);
        setNewFileName('');
        
        // Sélectionner le fichier nouvellement créé
        onFileSelect?.(filePath);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(`Erreur lors de la création du fichier: ${errorMessage}`);
        logger.error('Erreur de création de fichier:', error);
      }
    };
    
    // Handler for creating a new folder
    const handleNewFolder = async () => {
      if (!newFolderName.trim()) {
        toast.error("Veuillez entrer un nom de dossier valide");
        return;
      }
      
      try {
        const folderPath = nodePath.join(currentPath, newFolderName);
        await workbenchStore.createFolder(folderPath);
        toast.success(`Dossier "${newFolderName}" créé avec succès`);
        setShowNewFolderDialog(false);
        setNewFolderName('');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(`Erreur lors de la création du dossier: ${errorMessage}`);
        logger.error('Erreur de création de dossier:', error);
      }
    };
    
    // Handler for downloading a file
    const handleFileDownload = async (filePath: string) => {
      try {
        // Récupérer le contenu du fichier
        const fileContent = await workbenchStore.readFile(filePath);
        if (!fileContent) {
          toast.error("Fichier introuvable ou vide");
          return;
        }
        
        // Créer un blob avec le bon type MIME
        const extension = filePath.split('.').pop()?.toLowerCase() || '';
        const mimeTypes: Record<string, string> = {
          'html': 'text/html',
          'css': 'text/css',
          'js': 'application/javascript',
          'json': 'application/json',
          'txt': 'text/plain',
          'md': 'text/markdown',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'svg': 'image/svg+xml',
        };
        const mimeType = mimeTypes[extension] || 'application/octet-stream';
        
        const blob = new Blob([fileContent], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        // Créer un élément <a> pour télécharger
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop() || 'download';
        
        // Ajouter à la page, cliquer, puis supprimer
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Nettoyer l'URL du blob
        URL.revokeObjectURL(url);
        
        toast.success("Téléchargement démarré");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(`Échec du téléchargement: ${errorMessage}`);
        logger.error('Erreur de téléchargement:', error);
      }
    };
    
    // Handler for file selection
    const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      
      try {
        const buffer = await file.arrayBuffer();
        const content = new Uint8Array(buffer);
        // For now, import to the root directory. Could be enhanced later.
        // Ensure the path is absolute within the WORK_DIR context
        const targetPath = nodePath.join(WORK_DIR, file.name);

        logger.info(`Attempting to import file to: ${targetPath}`);
        await workbenchStore.importFile(targetPath, content);
        toast.success(`Fichier ${file.name} importé avec succès`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(`Échec de l'importation: ${errorMessage}`);
        logger.error(`Failed to import file ${file.name}:`, error);
      } finally {
        // Reset input value to allow importing the same file again
        if (event.target) {
          event.target.value = '';
        }
      }
    };

    return (
      <div className={classNames('text-sm flex flex-col h-full', className)}>
        {/* Hidden file input */}
        <input type="file" ref={fileInputRef} onChange={handleFileImport} style={{ display: 'none' }} />

        {/* Toolbar */}
        <div className="px-1.5 py-1 border-b border-bolt-border-secondary flex gap-1.5">
          {/* Nouveau fichier */}
          <IconButton
            title="Nouveau fichier"
            onClick={() => {
              setCurrentPath(WORK_DIR);
              setNewFileName('');
              setShowNewFileDialog(true);
            }}
            className="flex-1 justify-center text-xs" 
          >
            <div className="i-ph:file-plus-duotone text-lg"></div>
          </IconButton>

          {/* Nouveau dossier */}
          <IconButton
            title="Nouveau dossier"
            onClick={() => {
              setCurrentPath(WORK_DIR);
              setNewFolderName('');
              setShowNewFolderDialog(true);
            }}
            className="flex-1 justify-center text-xs" 
          >
            <div className="i-ph:folder-plus-duotone text-lg"></div>
          </IconButton>

          {/* Importer un fichier */}
          <IconButton
            title="Importer un fichier"
            onClick={handleImportClick}
            className="flex-1 justify-center text-xs" 
          >
            <div className="i-ph:upload-simple-duotone text-lg"></div>
          </IconButton>
        </div>

        {/* Confirmation dialog for file deletion */}
        <DialogRoot open={fileToDelete !== null}>
          <Dialog onBackdrop={() => setFileToDelete(null)} onClose={() => setFileToDelete(null)}>
            <DialogTitle>Supprimer le fichier ?</DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>
                  Êtes-vous sûr de vouloir supprimer le fichier{" "}
                  <strong>{fileToDelete?.name}</strong> ?
                </p>
                <p className="mt-1">Cette action est irréversible.</p>
              </div>
            </DialogDescription>
            <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
              <DialogButton type="secondary" onClick={() => setFileToDelete(null)}>
                Annuler
              </DialogButton>
              <DialogButton type="danger" onClick={handleDeleteFile}>
                Supprimer
              </DialogButton>
            </div>
          </Dialog>
        </DialogRoot>
        
        {/* Dialog for file renaming */}
        <DialogRoot open={fileToRename !== null}>
          <Dialog onBackdrop={() => setFileToRename(null)} onClose={() => setFileToRename(null)}>
            <DialogTitle>Renommer le fichier</DialogTitle>
            <DialogDescription asChild>
              <div className="mb-3">
                <p>Entrez le nouveau nom pour <strong>{fileToRename?.name}</strong> :</p>
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full mt-3 p-2 border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 rounded"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleRenameFile();
                    }
                  }}
                />
              </div>
            </DialogDescription>
            <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
              <DialogButton type="secondary" onClick={() => setFileToRename(null)}>
                Annuler
              </DialogButton>
              <DialogButton type="primary" onClick={handleRenameFile}>
                Renommer
              </DialogButton>
            </div>
          </Dialog>
        </DialogRoot>
        
        {/* Dialog for creating a new file */}
        <DialogRoot open={showNewFileDialog}>
          <Dialog onBackdrop={() => setShowNewFileDialog(false)} onClose={() => setShowNewFileDialog(false)}>
            <DialogTitle>Nouveau fichier</DialogTitle>
            <DialogDescription asChild>
              <div className="mb-3">
                <p>Entrez le nom du nouveau fichier :</p>
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full mt-3 p-2 border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 rounded"
                  autoFocus
                  placeholder="exemple.html"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleNewFile();
                    }
                  }}
                />
              </div>
            </DialogDescription>
            <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
              <DialogButton type="secondary" onClick={() => setShowNewFileDialog(false)}>
                Annuler
              </DialogButton>
              <DialogButton type="primary" onClick={handleNewFile}>
                Créer
              </DialogButton>
            </div>
          </Dialog>
        </DialogRoot>
        
        {/* Dialog for creating a new folder */}
        <DialogRoot open={showNewFolderDialog}>
          <Dialog onBackdrop={() => setShowNewFolderDialog(false)} onClose={() => setShowNewFolderDialog(false)}>
            <DialogTitle>Nouveau dossier</DialogTitle>
            <DialogDescription asChild>
              <div className="mb-3">
                <p>Entrez le nom du nouveau dossier :</p>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full mt-3 p-2 border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 rounded"
                  autoFocus
                  placeholder="mon-dossier"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleNewFolder();
                    }
                  }}
                />
              </div>
            </DialogDescription>
            <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
              <DialogButton type="secondary" onClick={() => setShowNewFolderDialog(false)}>
                Annuler
              </DialogButton>
              <DialogButton type="primary" onClick={handleNewFolder}>
                Créer
              </DialogButton>
            </div>
          </Dialog>
        </DialogRoot>
        
        {/* Context Menu */}
        {contextMenu && (
          <ContextMenu 
            x={contextMenu.x} 
            y={contextMenu.y} 
            onClose={() => setContextMenu(null)}
          >
            {contextMenu.node.kind === 'file' && (
              <>
                <ContextMenuItem 
                  icon="i-ph:pencil-simple-duotone" 
                  label="Modifier" 
                  onClick={() => {
                    onFileSelect?.(contextMenu.node.fullPath);
                    setContextMenu(null);
                  }} 
                />
                <ContextMenuItem 
                  icon="i-ph:copy-duotone" 
                  label="Copier" 
                  onClick={() => {
                    workbenchStore.setCopiedFile(contextMenu.node.fullPath, 'copy');
                    toast.success('Fichier copié');
                    setContextMenu(null);
                  }} 
                />
                <ContextMenuItem 
                  icon="i-ph:scissors-duotone" 
                  label="Couper" 
                  onClick={() => {
                    workbenchStore.setCopiedFile(contextMenu.node.fullPath, 'cut');
                    toast.success('Fichier prêt à être déplacé');
                    setContextMenu(null);
                  }} 
                />
                <ContextMenuDivider />
                <ContextMenuItem 
                  icon="i-ph:download-duotone" 
                  label="Télécharger" 
                  onClick={() => {
                    workbenchStore.readFile(contextMenu.node.fullPath)
                      .then(content => {
                        if (content) {
                          const fileName = contextMenu.node.fullPath.split('/').pop() || 'fichier';
                          const blob = new Blob([content], { type: 'application/octet-stream' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = fileName;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                          toast.success(`Téléchargement de ${fileName} démarré`);
                        } else {
                          toast.error("Impossible de télécharger le fichier");
                        }
                      })
                      .catch(error => toast.error(`Échec du téléchargement: ${error.message}`));
                    setContextMenu(null);
                  }} 
                />
                <ContextMenuItem 
                  icon="i-ph:pencil-line-duotone" 
                  label="Renommer" 
                  onClick={() => {
                    setNewFileName(contextMenu.node.name);
                    setFileToRename(contextMenu.node as FileNode);
                    setContextMenu(null);
                  }} 
                />
                <ContextMenuItem 
                  icon="i-ph:trash-duotone" 
                  label="Supprimer" 
                  danger={true}
                  onClick={() => {
                    setFileToDelete(contextMenu.node as FileNode);
                    setContextMenu(null);
                  }} 
                />
              </>
            )}
            {contextMenu.node.kind === 'folder' && (
              <>
                <ContextMenuItem 
                  icon="i-ph:clipboard-duotone" 
                  label="Coller ici" 
                  disabled={!workbenchStore.hasCopiedFile()}
                  onClick={() => {
                    if (workbenchStore.hasCopiedFile()) {
                      workbenchStore.pasteFile(contextMenu.node.fullPath)
                        .then(() => toast.success('Fichier collé avec succès'))
                        .catch(error => toast.error(`Échec du collage: ${error.message}`));
                    }
                    setContextMenu(null);
                  }} 
                />
              </>
            )}
          </ContextMenu>
        )}

        {/* File List Area */}
        <div className="overflow-y-auto flex-grow">
          {filteredFileList.map((fileOrFolder) => {
            switch (fileOrFolder.kind) {
              case 'file':
                return (
                  <File
                    key={fileOrFolder.id}
                    selected={selectedFile === fileOrFolder.fullPath}
                    file={fileOrFolder}
                    unsavedChanges={unsavedFiles?.has(fileOrFolder.fullPath)}
                    onClick={() => {
                      onFileSelect?.(fileOrFolder.fullPath);
                    }}
                    onDelete={() => setFileToDelete(fileOrFolder)}
                  />
                );
              case 'folder':
                return (
                  <Folder
                    key={fileOrFolder.id}
                    folder={fileOrFolder}
                    selected={allowFolderSelection && selectedFile === fileOrFolder.fullPath}
                    collapsed={collapsedFolders.has(fileOrFolder.fullPath)}
                    onClick={() => {
                      toggleCollapseState(fileOrFolder.fullPath);
                    }}
                  />
                );
              default:
                return undefined;
            }
          })}
        </div>
      </div>
    );
  },
);

export default FileTree;

interface FolderProps {
  folder: FolderNode;
  collapsed: boolean;
  selected?: boolean;
  onClick: () => void;
}

function Folder({ folder, collapsed, selected = false, onClick }: FolderProps) {
  const { depth, name } = folder;
  
  // Gestionnaire de clic droit pour dossier
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Empêcher le menu contextuel par défaut
    // Utiliser la même approche que pour les fichiers
    const event = new CustomEvent('filetree:contextmenu', {
      detail: {
        x: e.clientX,
        y: e.clientY,
        node: folder
      }
    });
    document.dispatchEvent(event);
  };
  
  return (
    <div onContextMenu={handleContextMenu}>
      <NodeButton
        className={classNames('group', {
          'bg-transparent text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive hover:bg-bolt-elements-item-backgroundActive':
            !selected,
          'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent': selected,
        })}
        depth={depth}
        iconClasses={classNames({
          'i-ph:caret-right scale-98': collapsed,
          'i-ph:caret-down scale-98': !collapsed,
        })}
        onClick={onClick}
      >
        {name}
      </NodeButton>
    </div>
  );
}

interface FileProps {
  file: FileNode;
  selected: boolean;
  unsavedChanges?: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function File({ file, onClick, onDelete, selected, unsavedChanges = false }: FileProps) {
  const { depth, name } = file;
  const [isHovering, setIsHovering] = useState(false);
  
  // Gestionnaire de clic droit directement dans le composant
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Empêcher le menu contextuel par défaut
    // Utiliser une approche alternative en utilisant des événements personnalisés
    const event = new CustomEvent('filetree:contextmenu', {
      detail: {
        x: e.clientX,
        y: e.clientY,
        node: file
      }
    });
    document.dispatchEvent(event);
  };
  
  return (
    <div 
      className="relative group"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onContextMenu={handleContextMenu}
    >
      <NodeButton
        className={classNames({
          'bg-transparent hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-item-contentDefault': !selected,
          'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent': selected,
        })}
        depth={depth}
        iconClasses={classNames('i-ph:file-duotone scale-98', {
          'group-hover:text-bolt-elements-item-contentActive': !selected,
        })}
        onClick={onClick}
      >
        <div
          className={classNames('flex items-center', {
            'group-hover:text-bolt-elements-item-contentActive': !selected,
          })}
        >
          <div className="flex-1 truncate pr-2">{name}</div>
          {unsavedChanges && <span className="i-ph:circle-fill scale-68 shrink-0 text-orange-500" />}
        </div>
      </NodeButton>
      
      {/* Bouton de suppression qui apparaît au survol */}
      {isHovering && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-bolt-elements-item-contentDanger opacity-75 hover:opacity-100"
          title="Supprimer le fichier"
        >
          <span className="i-ph:trash-duotone text-base"></span>
        </button>
      )}
    </div>
  );
}

interface ButtonProps {
  depth: number;
  iconClasses: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

function NodeButton({ depth, iconClasses, onClick, className, children }: ButtonProps) {
  return (
    <button
      className={classNames(
        'flex items-center gap-1.5 w-full pr-2 border-2 border-transparent text-faded py-0.5',
        className,
      )}
      style={{ paddingLeft: `${6 + depth * NODE_PADDING_LEFT}px` }}
      onClick={() => onClick?.()}
    >
      <div className={classNames('scale-120 shrink-0', iconClasses)}></div>
      <div className="truncate w-full text-left">{children}</div>
    </button>
  );
}

type Node = FileNode | FolderNode;

interface BaseNode {
  id: number;
  depth: number;
  name: string;
  fullPath: string;
}

interface FileNode extends BaseNode {
  kind: 'file';
}

interface FolderNode extends BaseNode {
  kind: 'folder';
}

function buildFileList(
  files: FileMap,
  rootFolder = '/',
  hideRoot: boolean,
  hiddenFiles: Array<string | RegExp>,
): Node[] {
  const folderPaths = new Set<string>();
  const fileList: Node[] = [];

  let defaultDepth = 0;

  if (rootFolder === '/' && !hideRoot) {
    defaultDepth = 1;
    fileList.push({ kind: 'folder', name: '/', depth: 0, id: 0, fullPath: '/' });
  }

  for (const [filePath, dirent] of Object.entries(files)) {
    const segments = filePath.split('/').filter((segment) => segment);
    const fileName = segments.at(-1);

    if (!fileName || isHiddenFile(filePath, fileName, hiddenFiles)) {
      continue;
    }

    let currentPath = '';

    let i = 0;
    let depth = 0;

    while (i < segments.length) {
      const name = segments[i];
      const fullPath = (currentPath += `/${name}`);

      if (!fullPath.startsWith(rootFolder) || (hideRoot && fullPath === rootFolder)) {
        i++;
        continue;
      }

      if (i === segments.length - 1 && dirent?.type === 'file') {
        fileList.push({
          kind: 'file',
          id: fileList.length,
          name,
          fullPath,
          depth: depth + defaultDepth,
        });
      } else if (!folderPaths.has(fullPath)) {
        folderPaths.add(fullPath);

        fileList.push({
          kind: 'folder',
          id: fileList.length,
          name,
          fullPath,
          depth: depth + defaultDepth,
        });
      }

      i++;
      depth++;
    }
  }

  return sortFileList(rootFolder, fileList, hideRoot);
}

function isHiddenFile(filePath: string, fileName: string, hiddenFiles: Array<string | RegExp>) {
  return hiddenFiles.some((pathOrRegex) => {
    if (typeof pathOrRegex === 'string') {
      return fileName === pathOrRegex;
    }

    return pathOrRegex.test(filePath);
  });
}

/**
 * Sorts the given list of nodes into a tree structure (still a flat list).
 *
 * This function organizes the nodes into a hierarchical structure based on their paths,
 * with folders appearing before files and all items sorted alphabetically within their level.
 *
 * @note This function mutates the given `nodeList` array for performance reasons.
 *
 * @param rootFolder - The path of the root folder to start the sorting from.
 * @param nodeList - The list of nodes to be sorted.
 *
 * @returns A new array of nodes sorted in depth-first order.
 */
function sortFileList(rootFolder: string, nodeList: Node[], hideRoot: boolean): Node[] {
  logger.trace('sortFileList');

  const nodeMap = new Map<string, Node>();
  const childrenMap = new Map<string, Node[]>();

  // pre-sort nodes by name and type
  nodeList.sort((a, b) => compareNodes(a, b));

  for (const node of nodeList) {
    nodeMap.set(node.fullPath, node);

    const parentPath = node.fullPath.slice(0, node.fullPath.lastIndexOf('/'));

    if (parentPath !== rootFolder.slice(0, rootFolder.lastIndexOf('/'))) {
      if (!childrenMap.has(parentPath)) {
        childrenMap.set(parentPath, []);
      }

      childrenMap.get(parentPath)?.push(node);
    }
  }

  const sortedList: Node[] = [];

  const depthFirstTraversal = (path: string): void => {
    const node = nodeMap.get(path);

    if (node) {
      sortedList.push(node);
    }

    const children = childrenMap.get(path);

    if (children) {
      for (const child of children) {
        if (child.kind === 'folder') {
          depthFirstTraversal(child.fullPath);
        } else {
          sortedList.push(child);
        }
      }
    }
  };

  if (hideRoot) {
    // if root is hidden, start traversal from its immediate children
    const rootChildren = childrenMap.get(rootFolder) || [];

    for (const child of rootChildren) {
      depthFirstTraversal(child.fullPath);
    }
  } else {
    depthFirstTraversal(rootFolder);
  }

  return sortedList;
}

function compareNodes(a: Node, b: Node): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1;
  }

  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}
