import { memo, useCallback } from 'react';
import { classNames } from '~/utils/classNames';

interface AttachedFilePreviewProps {
  files: File[];
  onRemoveFile?: (fileIndex: number) => void;
  className?: string;
  disabled?: boolean;
}

export const AttachedFilePreview = memo(({ 
  files, 
  onRemoveFile, 
  className,
  disabled = false 
}: AttachedFilePreviewProps) => {
  const isImage = (file: File): boolean => {
    return file.type.startsWith('image/');
  };

  const getFileIcon = (file: File): string => {
    if (file.type.includes('pdf')) return 'i-ph:file-pdf-duotone';
    if (file.type.includes('word') || file.name.endsWith('.doc') || file.name.endsWith('.docx')) 
      return 'i-ph:file-doc-duotone';
    if (file.type.includes('excel') || file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) 
      return 'i-ph:file-xls-duotone';
    if (file.type.includes('text') || file.name.endsWith('.txt')) 
      return 'i-ph:file-text-duotone';
    if (file.name.endsWith('.json')) 
      return 'i-ph:file-code-duotone';
    if (['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.py', '.java', '.c', '.cpp'].some(ext => 
      file.name.endsWith(ext))) 
      return 'i-ph:file-code-duotone';
    
    return 'i-ph:file-duotone';
  };

  const handleRemove = useCallback((index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!disabled && onRemoveFile) {
      onRemoveFile(index);
    }
  }, [onRemoveFile, disabled]);

  // Générer des URL d'objet pour les images
  const getImagePreviewUrl = useCallback((file: File): string => {
    return URL.createObjectURL(file);
  }, []);

  if (files.length === 0) return null;

  return (
    <div className={classNames('flex flex-wrap gap-2 mt-2', className)}>
      {files.map((file, index) => (
        <div 
          key={`${file.name}-${index}`}
          className="relative group"
        >
          <div 
            className={classNames(
              'flex flex-col items-center justify-center rounded-md overflow-hidden border',
              'border-bolt-elements-borderColor bg-bolt-elements-background-depth-0',
              'w-16 h-16 p-1 text-center text-xs'
            )}
          >
            {isImage(file) ? (
              <div className="w-full h-full flex items-center justify-center">
                <img 
                  src={getImagePreviewUrl(file)} 
                  alt={file.name} 
                  className="max-w-full max-h-full object-contain"
                  onLoad={() => URL.revokeObjectURL(getImagePreviewUrl(file))}
                />
              </div>
            ) : (
              <>
                <div className={classNames(getFileIcon(file), 'text-2xl text-bolt-elements-textSecondary')} />
                <div className="truncate w-full mt-1 text-bolt-elements-textSecondary">
                  {file.name.length > 10 ? file.name.substring(0, 7) + '...' : file.name}
                </div>
              </>
            )}
          </div>
          {!disabled && onRemoveFile && (
            <button
              type="button"
              onClick={(e) => handleRemove(index, e)}
              className={classNames(
                'absolute -top-1.5 -right-1.5 rounded-full w-5 h-5 flex items-center justify-center',
                'bg-bolt-elements-item-backgroundError text-white opacity-0 group-hover:opacity-100',
                'transition-opacity hover:brightness-95'
              )}
              title="Supprimer"
            >
              <div className="i-ph:x-bold text-xs" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
