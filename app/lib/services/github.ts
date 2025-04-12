import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('GitHubService');

// Interface pour la réponse de l'API GitHub pour l'utilisateur
interface GitHubUserResponse {
  login: string;
  id: number;
  name?: string;
  [key: string]: any; // Pour les autres propriétés que nous n'utilisons pas
}

export class GitHubService {
  private baseUrl = 'https://api.github.com';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  // Obtenir la structure d'un dépôt
  async getRepoContents(owner: string, repo: string, path: string = '', branch: string = 'main') {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    return this.fetchWithAuth(url);
  }

  // Télécharger un fichier spécifique
  async getFileContent(url: string) {
    return this.fetchWithAuth(url);
  }

  // Obtenir les informations du dépôt (branches, etc.)
  async getRepoInfo(owner: string, repo: string) {
    const url = `${this.baseUrl}/repos/${owner}/${repo}`;
    return this.fetchWithAuth(url);
  }

  // Récupérer les branches
  async getBranches(owner: string, repo: string) {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/branches`;
    return this.fetchWithAuth(url);
  }

  // Vérifier si le token est valide
  async validateToken() {
    try {
      const url = `${this.baseUrl}/user`;
      const response = await this.fetchWithAuth(url) as GitHubUserResponse;
      return { valid: true, user: response.login };
    } catch (error) {
      logger.error('Token validation failed:', error);
      return { valid: false, error };
    }
  }

  // Utilitaire pour les requêtes authentifiées
  private async fetchWithAuth(url: string) {
    try {
      // Déterminer si c'est un token à grain fin (commence souvent par github_pat_) ou un token classique (ghp_)
      const authHeader = this.token.startsWith('github_pat_') 
        ? `Bearer ${this.token}`  // Format pour les tokens à grain fin
        : `token ${this.token}`;  // Format ancien pour les tokens classiques
      
      const response = await fetch(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Bolt-App'
        }
      });
      
      if (!response.ok) {
        let errorMessage = `GitHub API error: ${response.status} ${response.statusText}`;
        
        try {
          const errorData = await response.json() as { message?: string, [key: string]: any };
          
          // Construire un message d'erreur plus détaillé en fonction de la réponse
          if (errorData.message) {
            errorMessage += ` - ${errorData.message}`;
            
            // Ajouter des détails spécifiques pour les problèmes courants
            if (response.status === 401) {
              errorMessage = 'Token d\'authentification invalide ou expiré. Veuillez vérifier vos informations d\'identification.';
            } else if (response.status === 403) {
              if (typeof errorData.message === 'string' && errorData.message.includes('rate limit')) {
                errorMessage = 'Limite de taux GitHub atteinte. Veuillez réessayer plus tard.';
              } else {
                errorMessage = 'Accès refusé. Votre token n\'a pas les permissions requises pour cette opération.';
              }
            } else if (response.status === 404) {
              errorMessage = 'Ressource introuvable. Vérifiez que le dépôt et le chemin existent et que vous avez accès.';
            }
            
            // Journaliser les données d'erreur complètes pour le débogage
            logger.error('GitHub API error details:', errorData);
          }
        } catch (e) {
          // Si la réponse n'est pas du JSON valide, utiliser simplement le message d'erreur de base
          logger.error('Error parsing GitHub error response:', e);
        }
        
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }
      
      return response.json();
    } catch (error) {
      // Améliorer la journalisation des erreurs réseau
      if (error instanceof TypeError && error.message.includes('fetch')) {
        logger.error('Network error when connecting to GitHub API:', error);
        throw new Error('Erreur de connexion au serveur GitHub. Vérifiez votre connexion internet.');
      }
      
      logger.error('GitHub API fetch error:', error);
      throw error;
    }
  }
}
