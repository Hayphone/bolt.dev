import { env } from 'node:process';

export function getAPIKey(cloudflareEnv: Env) {
  /**
   * VERSION PUBLIQUE:
   * Aucune clé API n'est stockée par défaut. Les utilisateurs doivent configurer leurs propres clés.
   * 
   * The `cloudflareEnv` is only used when deployed or when previewing locally.
   * In development the environment variables are available through `env`.
   */
  return ''; // Clé API vide pour la version publique
}
