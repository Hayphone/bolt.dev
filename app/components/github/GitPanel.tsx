import { useEffect, useState } from 'react';
import { gitStore, type GitFile } from '~/lib/stores/git';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogRoot } from '~/components/ui/Dialog';

export const GitPanel = () => {
  const gitFiles = useStore(gitStore.files);
  const isBusy = useStore(gitStore.isBusy);
  const hasRepo = useStore(gitStore.hasRepo);
  const currentBranch = useStore(gitStore.currentBranch);
  const gitMetadata = useStore(gitStore.gitMetadata);
  const commits = useStore(gitStore.commits);

  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (hasRepo) {
      gitStore.updateFileStatuses();
      gitStore.loadCommitHistory();
    }
  }, [hasRepo]);

  const handleStageFile = async (file: GitFile) => {
    if (file.staged) {
      await gitStore.unstageFile(file.path);
    } else {
      await gitStore.stageFile(file.path);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      toast.error('Veuillez entrer un message de commit');
      return;
    }

    const success = await gitStore.commit(commitMessage);
    if (success) {
      setCommitMessage('');
      setIsCommitDialogOpen(false);
    }
  };

  const handlePush = async () => {
    if (!gitMetadata) return;
    await gitStore.push('origin', currentBranch);
  };

  const handlePull = async () => {
    if (!gitMetadata) return;
    await gitStore.pull('origin', currentBranch);
  };

  const handleSelectAllFiles = (status: boolean) => {
    const newSelectedFiles: Record<string, boolean> = {};
    Object.keys(gitFiles).forEach((path) => {
      newSelectedFiles[path] = status;
    });
    setSelectedFiles(newSelectedFiles);
  };

  const handleStageSelected = async () => {
    const selectedPaths = Object.entries(selectedFiles)
      .filter(([_, selected]) => selected)
      .map(([path]) => path);

    for (const path of selectedPaths) {
      const file = gitFiles[path];
      if (file && !file.staged) {
        await gitStore.stageFile(path);
      }
    }

    // Réinitialiser la sélection
    setSelectedFiles({});
  };

  const handleToggleSelect = (path: string) => {
    setSelectedFiles((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  // Grouper les fichiers par statut
  const filesByStatus = Object.values(gitFiles).reduce(
    (acc, file) => {
      if (file.staged) {
        acc.staged.push(file);
      } else if (file.status === 'modified') {
        acc.modified.push(file);
      } else if (file.status === 'untracked') {
        acc.untracked.push(file);
      } else if (file.status === 'deleted') {
        acc.deleted.push(file);
      }
      return acc;
    },
    { staged: [] as GitFile[], modified: [] as GitFile[], untracked: [] as GitFile[], deleted: [] as GitFile[] }
  );

  const renderFileSection = (title: string, files: GitFile[], isStaged: boolean = false) => {
    if (files.length === 0) return null;

    return (
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2 flex items-center">
          <span>{title}</span>
          <span className="ml-2 bg-bolt-elements-background-depth-3 px-2 py-0.5 rounded-full text-xs">
            {files.length}
          </span>
        </h3>
        <ul className="space-y-1">
          {files.map((file) => {
            const fileName = file.path.split('/').pop() || '';
            const isSelected = !!selectedFiles[file.path];

            return (
              <li key={file.path} className="flex items-center text-sm">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleSelect(file.path)}
                  className="mr-2"
                />
                <button
                  onClick={() => handleStageFile(file)}
                  className={`flex-1 text-left px-2 py-1 rounded hover:bg-bolt-elements-background-depth-2 flex items-center ${
                    isStaged ? 'text-green-500' : ''
                  }`}
                >
                  <span className="inline-block w-6 text-center mr-1">
                    {file.status === 'modified' && <span className="text-amber-500">M</span>}
                    {file.status === 'untracked' && <span className="text-green-500">+</span>}
                    {file.status === 'deleted' && <span className="text-red-500">-</span>}
                  </span>
                  <span className="truncate">{fileName}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const hasChanges = Object.keys(gitFiles).length > 0;
  const hasUnstagedChanges = filesByStatus.modified.length > 0 || filesByStatus.untracked.length > 0 || filesByStatus.deleted.length > 0;
  const hasStagedChanges = filesByStatus.staged.length > 0;

  if (!hasRepo) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-bolt-elements-textTertiary mb-3">
          Aucun dépôt Git n'est initialisé pour ce projet.
        </p>
        <button
          onClick={() => gitStore.initRepo()}
          disabled={isBusy}
          className="px-3 py-1 bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text rounded-md text-sm inline-flex items-center justify-center"
        >
          {isBusy ? (
            <>
              <div className="i-svg-spinners:3-dots-fade mr-2" />
              Initialisation...
            </>
          ) : (
            'Initialiser Git'
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* En-tête avec infos du repo */}
      <div className="border-b border-bolt-elements-borderColor p-3 flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center">
            <span className="text-sm font-medium mr-2">Branche:</span>
            <span className="text-sm bg-bolt-elements-background-depth-2 px-2 py-0.5 rounded-md">
              {currentBranch}
            </span>
          </div>
          {gitMetadata && (
            <div className="text-xs text-bolt-elements-textTertiary mt-1">
              {gitMetadata.owner}/{gitMetadata.repo}
            </div>
          )}
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handlePull}
            disabled={isBusy || !gitMetadata}
            className="h-7 px-2 bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 text-xs rounded-md flex items-center"
            title="Pull"
          >
            <span className="i-ph:cloud-arrow-down mr-1" />
            Pull
          </button>
          <button
            onClick={handlePush}
            disabled={isBusy || !gitMetadata}
            className="h-7 px-2 bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 text-xs rounded-md flex items-center"
            title="Push"
          >
            <span className="i-ph:cloud-arrow-up mr-1" />
            Push
          </button>
        </div>
      </div>

      {/* Section changements */}
      <div className="flex-1 overflow-auto p-3">
        {hasChanges ? (
          <>
            {renderFileSection('Stagged Changes', filesByStatus.staged, true)}
            {renderFileSection('Modified', filesByStatus.modified)}
            {renderFileSection('Untracked', filesByStatus.untracked)}
            {renderFileSection('Deleted', filesByStatus.deleted)}
          </>
        ) : (
          <div className="text-center py-4 text-sm text-bolt-elements-textTertiary">
            Aucun changement détecté
          </div>
        )}

        {/* Historique des commits récents */}
        {commits.length > 0 && (
          <div className="mt-4 mb-2">
            <h3 className="text-sm font-medium mb-2">Commits récents</h3>
            <ul className="space-y-1 text-xs">
              {commits.slice(0, 5).map((commit) => (
                <li key={commit.hash} className="p-2 bg-bolt-elements-background-depth-1 rounded-md">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{commit.message}</span>
                    <span className="text-bolt-elements-textTertiary">
                      {new Date(commit.date).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-bolt-elements-textTertiary mt-1">
                    <span>{commit.author}</span>
                    <span className="text-bolt-elements-textTertiary ml-2">
                      {commit.hash.substring(0, 7)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions en bas */}
      <div className="border-t border-bolt-elements-borderColor p-3 flex justify-between items-center">
        <div className="flex space-x-2">
          <button
            onClick={() => handleSelectAllFiles(true)}
            disabled={!hasUnstagedChanges}
            className="h-7 px-2 bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 text-xs rounded-md"
          >
            Tout sélectionner
          </button>
          <button
            onClick={handleStageSelected}
            disabled={Object.values(selectedFiles).filter(Boolean).length === 0}
            className="h-7 px-2 bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 text-xs rounded-md"
          >
            Stager la sélection
          </button>
        </div>

        <button
          onClick={() => setIsCommitDialogOpen(true)}
          disabled={isBusy || !hasStagedChanges}
          className="h-7 px-3 bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text rounded-md text-xs flex items-center"
        >
          {isBusy ? (
            <>
              <div className="i-svg-spinners:3-dots-fade mr-1" />
              En cours...
            </>
          ) : (
            <>
              <span className="i-ph:git-commit mr-1" />
              Commit
            </>
          )}
        </button>
      </div>

      {/* Dialogue de commit */}
      <DialogRoot open={isCommitDialogOpen} onOpenChange={setIsCommitDialogOpen}>
        <Dialog onClose={() => setIsCommitDialogOpen(false)}>
          <div className="px-5 py-4 border-b border-bolt-elements-borderColor">
            <h2 className="text-lg font-medium">Créer un commit</h2>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Message de commit</label>
              <textarea
                className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md text-bolt-elements-textPrimary resize-none h-24"
                placeholder="Description des changements..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
            </div>

            <div className="text-sm">
              <h3 className="font-medium mb-1">Fichiers à commiter:</h3>
              <ul className="ml-2 space-y-1">
                {filesByStatus.staged.map((file) => (
                  <li key={file.path} className="flex items-center">
                    <span className="inline-block w-6 text-center mr-1">
                      {file.status === 'modified' && <span className="text-amber-500">M</span>}
                      {file.status === 'untracked' && <span className="text-green-500">+</span>}
                      {file.status === 'deleted' && <span className="text-red-500">-</span>}
                    </span>
                    <span className="truncate">{file.path.split('/').pop()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
            <DialogButton type="secondary" onClick={() => setIsCommitDialogOpen(false)}>
              Annuler
            </DialogButton>
            {!commitMessage.trim() ? (
              <button className="inline-flex h-[35px] items-center justify-center rounded-lg px-4 text-sm leading-none focus:outline-none bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text opacity-50 cursor-not-allowed">
                Commit
              </button>
            ) : (
              <DialogButton type="primary" onClick={handleCommit}>
                Commit
              </DialogButton>
            )}
          </div>
        </Dialog>
      </DialogRoot>
    </div>
  );
};
