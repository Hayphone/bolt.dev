# Bolt Public - Version Publique

Cette version de l'application Bolt a été préparée pour être partagée avec d'autres utilisateurs. Toutes les informations personnelles et sensibles ont été supprimées pour des raisons de sécurité.

## Informations importantes

Avant d'utiliser cette application, certaines configurations sont nécessaires :

### 1. Configuration de l'API (Modèles d'IA)

Pour que l'application fonctionne correctement, vous devez configurer une API pour les modèles d'IA :

- Cliquez sur l'icône de paramètres dans l'interface
- Choisissez votre fournisseur d'API (Anthropic, OpenAI, Google ou personnalisé)
- Entrez votre clé API
- Pour obtenir une clé API :
  - [Anthropic Claude](https://console.anthropic.com/) - Créez un compte et générez une clé API
  - [OpenAI](https://platform.openai.com/) - Créez un compte et générez une clé API
  - [Google AI (Gemini)](https://aistudio.google.com/) - Créez un compte et générez une clé API

### 2. Configuration GitHub (Optionnel)

Si vous souhaitez utiliser les fonctionnalités GitHub :

- Vous devrez configurer un token GitHub personnel
- L'application vous guidera dans le processus lorsque vous tenterez d'utiliser une fonctionnalité GitHub
- Pour générer un token GitHub :
  - Accédez à vos paramètres GitHub → Developer settings → Personal access tokens
  - Générez un nouveau token avec les permissions 'repo' et 'read:user'

## Notes sur cette version publique

- Aucun token ou clé API personnelle n'est inclus dans cette version
- Aucune donnée utilisateur n'est préchargée
- Le localStorage démarre vide
- Cette version est prête à être configurée avec vos propres informations d'identification

## Démarrer l'application

```
npm install
npm run dev
```

Après le démarrage, vous accéderez à l'application et serez invité à configurer vos clés API et tokens selon vos besoins.

## Feedback

Si vous rencontrez des problèmes ou avez des suggestions, n'hésitez pas à les partager avec l'auteur original.
