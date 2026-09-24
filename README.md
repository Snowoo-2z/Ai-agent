# Aster Chat

Aster est une plateforme de chat IA type ChatGPT, construite avec Node.js et Express. Les conversations et les profils sont stockés dans un dépôt GitHub privé via l'API GitHub Contents, tandis que les réponses sont générées par l'API Mistral.

## Fonctionnalités

- inscription et connexion avec mot de passe hashé avec `scrypt` ;
- session sécurisée par cookie HTTP-only signé ;
- création, consultation et suppression de conversations ;
- historique au format JSON dans `users/{pseudo}/conversations/` ;
- réponse Mistral configurable par `MISTRAL_MODEL`, avec appel de fonction pour l’heure exacte et recherche web ;
- rendu Markdown sécurisé : titres, listes, liens, tableaux et blocs de code ;
- interface responsive, thème clair/sombre, panneau de personnalisation du logo et aucun build frontend nécessaire ;
- création instantanée des conversations : le fichier GitHub est écrit uniquement au premier message ;
- déploiement direct sur Render avec `render.yaml`.

## Structure GitHub créée

```text
users/
└── {pseudo}/
    ├── profile.json
    └── conversations/
        ├── conv_<uuid>.json
        └── ...

database/
```

Le dossier `conversations` est créé automatiquement par le premier enregistrement d'une conversation. Le dossier `database` peut rester vide comme prévu par l'architecture.

## Variables d'environnement

Copier `.env.example` vers `.env` pour un lancement local. Les variables nécessaires sont :

- `GITHUB_TOKEN` : token GitHub avec accès `Contents: Read and write` au dépôt choisi ;
- `GITHUB_OWNER` et `GITHUB_REPO` : propriétaire et nom du dépôt servant de BDD ;
- `GITHUB_BRANCH` : branche de stockage, généralement `main` ;
- `MISTRAL_API_KEY` : clé API Mistral ;
- `MISTRAL_MODEL` : modèle à appeler, par défaut `ministral-8b-latest` ;
- `TAVILY_API_KEY` : optionnel, améliore la recherche web appelée par l’outil de l’IA ; sans cette clé, un fallback DuckDuckGo est utilisé ;
- `SESSION_SECRET` : secret long et aléatoire pour les sessions.

Pour une offre Mistral qui expose encore le modèle ouvert 7B, définir `MISTRAL_MODEL=open-mistral-7b` dans Render.

## Lancement local

```bash
npm install
cp .env.example .env
# renseigner les variables dans .env
npm start
```

Ouvrir <http://localhost:10000>. Le endpoint de santé est disponible sur `/healthz`.

## Déploiement Render

1. Créer ou sélectionner le dépôt GitHub qui servira de base de données.
2. Donner au token GitHub uniquement l'accès `Contents: Read and write` à ce dépôt.
3. Créer un **Web Service** Render depuis ce dépôt et renseigner les variables de `render.yaml`.
4. Vérifier que `GITHUB_BRANCH` correspond à la branche réellement utilisée par le dépôt de données.

Le dépôt qui héberge l'application et le dépôt utilisé comme base de données peuvent être distincts. Ne jamais publier `.env` ou le token GitHub dans le dépôt.
