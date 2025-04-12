import { useState, useEffect } from 'react';
import { Dialog, DialogButton, DialogRoot } from '~/components/ui/Dialog';
import { saveGitHubToken } from '~/lib/stores/github';
import { GitHubService } from '~/lib/services/github';
import { toast } from 'react-toastify';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('GitHubTokenConfig');

interface GitHubTokenConfigProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function GitHubTokenConfig({ open, onClose, onSaved }: GitHubTokenConfigProps) {
  // Version publique : token vide par défaut
  const [token, setToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  // Valider le token
  const validateToken = async (tokenToValidate: string) => {
    if (!tokenToValidate.trim()) {
      setTokenValid(false);
      return false;
    }

    setIsValidating(true);
    try {
      const github = new GitHubService(tokenToValidate);
      const result = await github.validateToken();
      
      setTokenValid(result.valid);
      if (result.valid && result.user) {
        setUsername(result.user);
      }
      
      return result.valid;
    } catch (error) {
      logger.error('Erreur lors de la validation du token:', error);
      setTokenValid(false);
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  // Sauvegarder le token
  const handleSave = async () => {
    // Valider d'abord le token
    const isValid = await validateToken(token);
    
    if (isValid) {
      saveGitHubToken(token);
      toast.success('Token GitHub sauvegardé avec succès.');
      onSaved?.();
      onClose();
    } else {
      toast.error('Token GitHub invalide. Veuillez vérifier que le token a les permissions nécessaires.');
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog onClose={onClose}>
        <div className="px-5 py-4 border-b border-bolt-elements-borderColor">
          <h2 className="text-lg font-medium">Configuration GitHub API</h2>
        </div>
        
        <div className="p-5 space-y-4">
          {/* Notification de version publique */}
          <div className="p-3 bg-blue-100 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-800 rounded-md text-blue-800 dark:text-blue-400 text-sm">
            <p>📢 <strong>Version publique :</strong> Vous devez configurer votre propre token GitHub. Aucun token pré-existant n'est chargé pour des raisons de sécurité.</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Token d'accès personnel GitHub</label>
            <input
              type="password"
              className="w-full px-3 py-2 bg-bolt-elements-background-depth-1 border border-bolt-border-primary rounded-md text-bolt-elements-textPrimary"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_votre_token_ici"
            />
            <p className="text-xs text-bolt-elements-textTertiary mt-1">
              Créez un token d'accès sur GitHub avec les permissions 'repo' et 'read:user'.
            </p>
          </div>
          
          {tokenValid === true && (
            <div className="p-3 bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-800 rounded-md text-green-800 dark:text-green-400 text-sm">
              ✅ Token valide. Connecté en tant que: {username}
            </div>
          )}
          
          {tokenValid === false && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md text-red-800 dark:text-red-400 text-sm">
              ❌ Token invalide. Veuillez vérifier que le token est correct et possède les bonnes permissions.
            </div>
          )}
          
          <div>
            <h3 className="text-sm font-medium mb-1">Comment obtenir un token GitHub?</h3>
            <ol className="list-decimal list-inside text-xs text-bolt-elements-textSecondary space-y-1 ml-1">
              <li><strong>Option recommandée (tokens classiques)</strong>: GitHub → Settings → Developer settings → <strong>Personal access tokens (classic)</strong></li>
              <li>Cliquez sur "Generate new token" → "Generate new token (classic)"</li>
              <li>Donnez un nom à votre token, ex: "Bolt App"</li>
              <li>Sélectionnez un délai d'expiration (ex: 90 jours)</li>
              <li>Accordez les scopes: <strong>repo</strong> (cochez toutes les options) et <strong>read:user</strong></li>
              <li>Cliquez sur "Generate token" et <strong>copiez immédiatement</strong> le token généré (commence par ghp_)</li>
            </ol>
            <p className="text-xs text-bolt-elements-textTertiary mt-2 mb-1">Alternative: tokens à grain fin</p>
            <ol className="list-decimal list-inside text-xs text-bolt-elements-textSecondary space-y-1 ml-1">
              <li>GitHub → Settings → Developer settings → Personal access tokens → <strong>Fine-grained tokens</strong></li>
              <li>Cliquez sur "Generate new token"</li>
              <li>Donnez un nom à votre token et sélectionnez un délai d'expiration</li>
              <li>Sélectionnez les dépôts: "All repositories" ou spécifiques</li>
              <li>Dans "Repository permissions": accordez "Contents" → "Read and write"</li>
              <li>Dans "Account permissions": accordez "Read-only" pour "User email addresses"</li>
              <li>Cliquez sur "Generate token" et copiez le token généré (commence par github_pat_)</li>
            </ol>
          </div>
        </div>
        
        <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
          <DialogButton type="secondary" onClick={onClose}>
            Annuler
          </DialogButton>
          
          <button
            onClick={handleSave}
            disabled={!token.trim() || isValidating}
            className={`inline-flex h-[35px] items-center justify-center rounded-lg px-4 text-sm leading-none focus:outline-none bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text ${(!token.trim() || isValidating) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isValidating ? (
              <>
                <div className="i-svg-spinners:3-dots-fade mr-2" />
                Validation...
              </>
            ) : (
              'Sauvegarder'
            )}
          </button>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
