import { atom } from 'nanostores';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('GitHubStore');

// Store pour le token GitHub
export const githubTokenStore = atom<string | null>(null);

// Clé pour stocker le token dans localStorage
const GITHUB_TOKEN_KEY = 'github_token';

// Version publique : pas de chargement automatique des tokens
// Pour utiliser GitHub, l'utilisateur devra configurer son propre token
logger.info('Version publique : configuration GitHub requise');

/**
 * Sauvegarder le token GitHub
 * @param token Le token à sauvegarder
 */
export function saveGitHubToken(token: string) {
  try {
    localStorage.setItem(GITHUB_TOKEN_KEY, token);
    githubTokenStore.set(token);
    logger.info('Token GitHub sauvegardé');
    return true;
  } catch (error) {
    logger.error('Erreur lors de la sauvegarde du token GitHub:', error);
    return false;
  }
}

/**
 * Effacer le token GitHub
 */
export function clearGitHubToken() {
  try {
    localStorage.removeItem(GITHUB_TOKEN_KEY);
    githubTokenStore.set(null);
    logger.info('Token GitHub effacé');
    return true;
  } catch (error) {
    logger.error('Erreur lors de la suppression du token GitHub:', error);
    return false;
  }
}
