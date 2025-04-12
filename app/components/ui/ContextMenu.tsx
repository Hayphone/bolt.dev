import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '~/utils/classNames';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Ajuster la position pour éviter de sortir de l'écran
  const adjustPosition = () => {
    if (!menuRef.current) return { x, y };

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width;
    }

    if (y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height;
    }

    return { x: adjustedX, y: adjustedY };
  };

  // Fermer le menu lorsqu'on clique en dehors
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Ajuster la position après le rendu
  useEffect(() => {
    const position = adjustPosition();
    if (menuRef.current) {
      menuRef.current.style.left = `${position.x}px`;
      menuRef.current.style.top = `${position.y}px`;
    }
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-bolt-elements-background-depth-3 border-1.5 border-bolt-elements-borderColor-focused rounded-lg shadow-xl py-1.5 min-w-[200px] backdrop-blur-sm"
      style={{ 
        left: `${x}px`, 
        top: `${y}px`,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)' 
      }}
    >
      {children}
    </div>,
    document.body
  );
}

interface ContextMenuItemProps {
  icon?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function ContextMenuItem({ icon, label, onClick, disabled = false, danger = false }: ContextMenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'flex items-center w-full text-left px-4 py-2 gap-2.5 text-sm font-medium transition-colors duration-150',
        {
          'opacity-60 cursor-not-allowed': disabled,
          'hover:bg-bolt-elements-item-backgroundActive focus:bg-bolt-elements-item-backgroundActive focus:outline-none': !disabled && !danger,
          'text-bolt-elements-item-contentDanger hover:bg-red-500/20 hover:text-red-400 focus:outline-none': danger,
          'text-bolt-elements-item-contentEmphasis': !danger,
        }
      )}
    >
      {icon && <div className={classNames(icon, 'text-xl shrink-0')}></div>}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function ContextMenuDivider() {
  return <div className="h-px bg-bolt-elements-borderColor-subtle my-1.5 mx-2" />;
}
