# 🍷 Millésime — Cave à vin pour Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://github.com/hacs/integration)
[![version]([https://img.shields.io/github/v/release/Redsklns/ha-millesime?style=flat-square&color=7B1D2E&label=version](https://img.shields.io/github/v/release/Redsklns/ha-millesime?style=flat-square&color=7B1D2E&label=version)
[![Offrir un verre de vin](https://img.shields.io/badge/🍷_Offrir_un_verre_de_vin-PayPal-7B1D2E.svg?style=flat-square)](https://paypal.me/Redsklns)

**Millésime** transforme Home Assistant en gestionnaire de cave à vin complet : visualisez vos bouteilles dans une scène **3D réaliste**, scannez les étiquettes par **photo**, suivez la valeur de votre collection et tenez un **journal de dégustation**.

Intégration 100 % locale (vos données restent chez vous), pensée **mobile-first** pour un usage quotidien depuis l'application Home Assistant.

---

## ✨ Fonctionnalités

### Visualisation
- **Trois vues** au choix : 🍾 Bouteilles 2D, ⠿ Pastilles, 🧊 **Scène 3D** (WebGL/Three.js) — sélecteur dans ⚙️ Options, mémorisé par appareil
- **Rendu 3D réaliste** : bouteilles modelées par forme (bordelaise, bourguignonne, champenoise avec muselet et bouchon champignon, flûte d'Alsace, ligérienne) — **silhouette choisie sur la fiche ou déduite de la région**, et **dimensions réelles 75 cl par forme** (une flûte d'Alsace 360×⌀60 est réellement plus longue et plus fine qu'une champenoise 310×⌀88, et déborde de la clayette comme en vraie cave) — verre teinté transparent laissant voir la robe du vin, étiquette nominative sur chaque bouteille, ombres de contact douces
- **Casiers configurables** : meuble complet avec étagères internes, 5 essences de bois (chêne, noyer, merisier, grisé, wengé) ou structure en **fer forgé**, montants, pieds, croisillons et toit optionnels
- **Dispositions** : côte à côte, tête-bêche, semi-couché, superposition (2 à 4 niveaux **empilés en pyramide**, comme en vraie cave)
- **Espacement des clayettes réglable** ↕️ (60–180 %, vue 3D) : slider dans ⚙️ Options → Mode d'affichage, appliqué en direct
- **Glisser-déposer** (souris ET tactile) : déplacer une bouteille sur une case vide, ou la **permuter** avec une bouteille déjà en place — fonctionne même cave pleine
- **Responsive par largeur de carte** (container queries) : la carte s'adapte à sa colonne, pas à l'écran — utilisable en pleine largeur, demi-colonne ou panneau latéral
- **Drag & drop** en 3D pour déplacer ou permuter les bouteilles
- Vue mémorisée d'une session à l'autre, et configurable via YAML (`default_view`)
- S'adapte au **thème** Home Assistant (clair / sombre)

### Gestion des vins
- **Ajout par photo** 📷 : l'IA lit l'étiquette et remplit automatiquement la fiche
- **Recherche par nom** : trouvez n'importe quel vin (nom, producteur, appellation, région, millésime)
- **Estimation de prix** automatique et suivi de la **valeur de la cave** dans le temps (graphique)
- **Formats** : 75 cl, magnum, demi… chaque bouteille rendue à l'échelle dans son emplacement
- **Coup de cœur** ⭐, commentaire par bouteille, fenêtre de dégustation (✅ à boire / ⏳ trop tôt / 🔴 passé l'apogée)
- **Anti-doublon** : impossible de placer deux bouteilles au même emplacement
- **Déplacement d'un casier entier** 📦 en un clic
- **Rafraîchissement des fiches** ♻️ : fusion des doublons et complétion automatique des champs vides
- **Accords mets/vin** 🍽️ : ~900 plats classés par ordre alphabétique — pièces de boucherie nommées (côte de bœuf, onglet, araignée de porc…), poissons, fromages, recettes du monde — plus recherche libre et renfort IA

### Sommelier IA
- **Boutons 🍾 À ouvrir et 🍷 Sommelier** directement dans l'en-tête (rouge Millésime), bouton **➕ Ajouter** unifié (vin ou casier), **icônes personnalisables** dans ⚙️ Options → 🎨 Personnalisation
- **Accord sur le repas complet** 🍷 : entrée / plat / dessert → l'IA choisit 1 à 2 bouteilles **de votre cave** qui couvrent tout le menu, avec conseils de service — et les met en surbrillance dans la cave
- **« Envie de… »** 🍷 : envie d'un bon vin, tout simplement ? Choisissez le **profil aromatique** et/ou la **structure du moment** (Tannique, Souple, Corsé, Léger…), le sommelier propose **une seule bouteille** de la cave au bon profil et à la bonne apogée — **prix affiché** pour trancher. Repli local sans IA
- **Conseil d'achat** 🛒 : audit de l'équilibre de la cave (styles, trous et embouteillages d'apogée) et 5 suggestions précises sous budget, avec région prioritaire facultative
- **Analyse d'opportunité** 🏪 : en magasin, saisissez ou **scannez** la bouteille repérée — verdict doublon/manque, millésime et prix à viser (indicatifs)
- **Profil aromatique** 🌸 : répartition sur les 11 **séries aromatiques œnologiques** (Fruité, Floral, Végétal, Minéral, Épicé, Boisé, Empyreumatique, Animal, Fermentaire, Sous-bois, Évolution), toujours visible sur la fiche, radar aux **axes adaptés à la couleur du vin** ou barres, avec **glossaire ℹ️** intégré pour les non-initiés
- **Structure en bouche** 🍷 : 6 axes de dégustation (Tanins, Corps, Acidité, Gras, Alcool, Persistance) estimés par l'IA, affichés en barres sur la fiche, avec glossaire ℹ️ — et exploités par « Envie de… »
- **IA automatique dans les accords** ✨ : la sélection d'un plat lance directement l'affinage Gemini (désactivable), fenêtre de progression avec **consommation de tokens** et **% du budget quotidien** du free tier Gemini (barre dans ⚙️ Options)

### Apogée & garde
- **Profil de garde** 📈 : graphique dépliant, un segment horizontal par vin couvrant sa fenêtre d'apogée, ligne « aujourd'hui » — **filtres par couleur de vin et par région**
- **Top 10 à ouvrir en priorité**, trié par urgence — les apogées **dépassées remontent en tête avec leur année réelle** (« avant 2020 ⚠️ »)
- Fenêtres d'apogée **resserrées et réalistes** générées par l'IA (fini les 2025-2045)

### Mobile & affichage
- **Glisser-déposer tactile** : appui long ~260 ms pour saisir une bouteille, dépôt sur case vide (déplacement) ou occupée (**permutation atomique**, fonctionne cave pleine)
- **Responsive à la largeur de carte** (container queries) : la carte s'adapte à sa colonne, typographie fluide, compatible card-mod (`--fs-base`)
- **3D fiabilisée** : récupération automatique du contexte WebGL, gestion de la rotation d'écran, largeur plafonnée sur grand écran

### Multi-caves
- **Plusieurs caves** dans la même instance : sélecteur dans l'en-tête de la carte, gestion (ajout, renommage, suppression) via ⚙️ Options
- **Capteurs T° / hygrométrie et historique de valeur propres à chaque cave** ; capteurs Home Assistant globaux + par cave (bouteilles, valeur)
- Option YAML `cellar_id` pour épingler une carte à une cave donnée (une carte par pièce/dashboard) ; le journal de dégustation reste commun

### Journal & import
- **Journal de dégustation** 📓 : marquez une bouteille comme bue (note ⭐, date, commentaire), elle est archivée avec statistiques (nombre, note moyenne, total dépensé)
- **Import Vinotag** 📥 : importez votre cave depuis un export CSV

### Intelligence artificielle
- **Google Gemini 3** pour la recherche texte et la lecture de photo (repli automatique sur Gemini 2.5 si indisponible)
- **Open Food Facts** en secours, sans clé requise — 150 000+ vins référencés
- Clé Gemini **gratuite** et optionnelle

---

## 📦 Installation

### Via HACS (recommandé)
1. HACS → ⋮ → **Dépôts personnalisés**
2. Ajoutez `https://github.com/Redsklns/ha-millesime` — catégorie **Intégration**
3. Installez **Millésime**, puis redémarrez Home Assistant
4. **Paramètres → Appareils et services → Ajouter une intégration → Millésime**

### Manuelle
1. Copiez `custom_components/millesime/` dans le dossier `config/custom_components/` de Home Assistant
2. Redémarrez Home Assistant et ajoutez l'intégration — la carte est **intégrée au composant et servie automatiquement**, rien à copier dans `www/`

### Carte Lovelace
La ressource est **enregistrée automatiquement** au démarrage (`/millesime/millesime-card.js?v=…`), avec rechargement automatique à chaque mise à jour — rien à faire.
Ajoutez simplement la carte à votre tableau de bord :
```yaml
type: custom:millesime-card
# Options facultatives :
default_view: 3d          # 2d | dot | 3d
cellar_id: main           # épingle la carte à une cave (multi-caves) ; omis = sélecteur dans l'en-tête
rack_defaults:
  material: chene         # chene | noyer | merisier | grise | wenge | fer
racks:
  Cave principale:
    material: fer
    accent: "#7B1D2E"
```

---

## 🔑 Configuration de la clé Gemini (optionnelle)

1. Créez une clé gratuite sur [aistudio.google.com](https://aistudio.google.com)
2. Renseignez-la à la configuration de l'intégration (ou plus tard via ⚙️)

Sans clé, Millésime fonctionne avec Open Food Facts (recherche par nom et code-barres, sans notes de dégustation IA).

---

## 🛠️ Services disponibles

Gestion des vins (`add_wine`, `update_wine`, `remove_wine`), des emplacements (`add_slot`, `update_slot`, `move_slot`, `remove_slot`), des casiers (`add_rack`, `update_rack`, `remove_rack` — avec `levels` pour la superposition et `cellar_id` pour la cave cible), des caves (`add_cellar`, `remove_cellar`, `rename_cellar`), dégustation (`drink_bottle`, `delete_tasting`), maintenance (`refresh_wines`, `value_snapshot`) et import (`import_vinotag`, avec `cellar_id` optionnel).

> Les anciens services (`add_bottle`, `add_floor`…) restent acceptés comme alias pour la compatibilité des automatisations existantes.

---

## 🤖 Un projet développé avec l'IA

L'intégralité de Millésime a été conçue et développée en collaboration avec **Claude** (Anthropic), de l'architecture backend Python à la carte Lovelace 3D — une expérience grandeur nature des capacités de l'IA sur un vrai projet logiciel.

---

## 📝 Changelog

*Les 30 derniers jours — l'historique complet est disponible dans les [releases GitHub](https://github.com/Redsklns/ha-millesime/releases).*

### [7.1.3] — 2026-07
Correctif critique du remplissage par IA (scan photo et recherche).

- 🐛 **Erreur 404 « service_unavailable » sur tous les modèles Gemini** : les noms de modèles étaient codés en dur et n'existaient pas sur toutes les clés API, cassant le scan photo et la recherche. L'intégration **découvre désormais dynamiquement** les modèles réellement disponibles pour la clé de l'utilisateur (au démarrage et à chaque changement de clé), et choisit automatiquement le meilleur pour le texte et la vision. Repli sur les modèles stables (2.5 flash) si la découverte échoue

### [7.1.2] — 2026-07
Correctifs de rendu et d'ergonomie.

- 🐛 **Surbrillance des Occasions** : ouvrir la fiche d'un vin lève désormais aussi le filtre d'occasion (les bouteilles grisées reviennent à la normale) — plus seulement la localisation d'une bouteille
- 🐛 **Superposition** : suppression de la trace sombre résiduelle des emplacements vides des couches supérieures (les silhouettes masquées écrivaient dans le tampon de profondeur et occultaient le fond) — masquage réel `visible=false`, les emplacements restent tappables et réapparaissent pendant un glisser/déposer
- 🍾 **Bordelaise** : col allongé et **capsule longue (48 mm)** façon cru de garde, calqués sur des bouteilles réelles — encombrement et 5 autres formes inchangés

### [7.1.1] — 2026-07
Correctif critique de la 7.1.0.

- 🐛 **Carte figée au chargement** : la refonte des profils de bouteilles avait supprimé par erreur trois définitions (`TYPE_SHAPE`, `REGION_SHAPES`, `shapeKindOf`) encore utilisées — `ReferenceError` au premier rendu, vues 2D/3D bloquées. Réinstallées et validées par un harnais d'exécution complet (Three.js réel + DOM) désormais systématique avant chaque livraison

### [7.1.0] — 2026-07
Version fonctionnelle majeure : profil de Structure, nomenclature œnologique, header refondu, profils de bouteilles aux dimensions réelles.

- **🍷 Structure en bouche** : nouveau champ `structure_profile` par vin (6 axes de dégustation : Tanins, Corps, Acidité, Gras, Alcool, Persistance, 0–100), généré par « Compléter les fiches », affiché sur la fiche du vin (barres à la couleur du type) et exploitable dans « Envie de… »
- **« Envie de… » enrichie** : deuxième rangée de critères **Structure** (Tannique, Souple, Corsé, Léger, Vif & frais, Rond & moelleux, Puissant, Long en bouche) cumulable avec les arômes ; repli local scorant sur les vraies données de structure. 🐛 Corrige la fermeture intempestive de la fenêtre à chaque sélection de critère (conflit de classe avec les Occasions)
- **Nomenclature experte** : les familles aromatiques adoptent les séries œnologiques (Empyreumatique, Fermentaire, Sous-bois, Évolution remplacent Grillé, Lacté, Terreux, Tertiaire) — rétro-compatibilité totale des profils existants ; prompts IA mis à jour
- **Glossaires ℹ️** : définitions d'une ligne dépliables sur les sections Arômes et Structure de la fiche et sur les deux rangées de « Envie de… »
- **Header refondu** : « À ouvrir » remonte dans la rangée d'actions (rouge, à gauche du Sommelier) ; « + Casier » et « + Vin » fusionnés en « ➕ Ajouter » (gris, menu à deux choix) ; les deux rangées du header partagent la même hauteur ; la rangée capteurs (T°/hygrométrie) s'étend sur toute la largeur
- **🎨 Personnalisation** : nouveau sous-menu dans ⚙️ Options — choix de l'icône des boutons « À ouvrir » (tire-bouchon, bouteille, bouchon) et « Sommelier » (nœud papillon, grappe, verre), appliqué en direct et mémorisé par appareil
- **Profils de bouteilles recalculés sur dimensions réelles 75 cl** : chaque forme a désormais SON rayon et SA longueur (bordelaise 300×⌀75, bourguignonne 295×⌀80 sans épaule, champenoise 310×⌀88, flûte d'Alsace 360×⌀60 qui déborde légèrement de la clayette comme en vraie cave, ligérienne 310×⌀73, provençale 300×⌀72) — cotes d'accessoires (capsule, bouchon, collerette, muselet, étiquette) recalées au millimètre, appliqué à toutes les vues (3D toutes orientations, 2D, fantômes)
- **Superposition** : les silhouettes des emplacements vides des couches supérieures sont masquées au repos (elles gênaient la lecture) et réapparaissent le temps d'un glisser/déposer ; les emplacements restent tappables

### [7.0.2] — 2026-07
Affinage visuel : bordelaises fidèles, rouge Millésime partout, espacement réglable.

- **Rendu des bouteilles refondu (toutes les vues)** : bordelaise **par défaut** pour rouges et blancs (fût droit ~60 %, épaule haute et courte, profil calé sur une 75 cl réelle) ; **silhouette déduite de la région** quand la fiche ne précise rien (bourgogne/rhône → bourguignonne, alsace → flûte, sauternes → bordelaise) ; bouteilles affinées (rayon 0,43 → 0,41) pour des proportions réalistes. Corrige au passage un bug silencieux : le choix manuel de forme n'était **jamais appliqué en vue 3D**
- **Rouge Millésime partout** : bouton Sommelier (fond `#7B1D2E`, icône verre SVG blanche), sous-menus, chips et boutons « Envie de… » — fin du violet. Boutons pleine largeur harmonisés (42 px, rayon 10) : « Envie de… trouver mon vin », « Choisir dans ma cave », audits Sommelier
- **Options réorganisées** : actions cliquables en haut, réglages à choix en bas ; **nouveau slider « Espacement des clayettes »** (60–180 %) intégré à Mode d'affichage, visible en vue 3D uniquement, appliqué en direct et mémorisé par appareil
- **Vue 3D** : rails ⚙/📦/✕ **ancrés au bord droit de la carte** (compensation du centrage desktop), zone réservée réduite de 48 → 40 px au profit de la largeur des clayettes

### [7.0.1] — 2026-07
Sommelier dans le header, « Envie de… », budget de tokens, filtres de garde.

- **« Envie de… »** : nouvel onglet dans « À ouvrir » — profil aromatique souhaité (+ couleur) → l'IA propose **une bouteille** de la cave, prête à boire, avec **prix affiché** ; repli local sans clé. Nouveau websocket `craving`
- **Sommelier IA dans le header** : le sélecteur de vue migre dans ⚙️ Options, remplacé par un bouton d'accès direct
- **Budget de tokens** : barre de consommation quotidienne avec **% du budget estimé** du free tier Gemini (constante ajustable `GEMINI_FREE_TIER_DAILY_BUDGET`), rappelé sur la fenêtre de progression IA et la complétion des fiches
- **Profil de garde** : filtres **couleur** et **région** ; le top priorités inclut les **apogées dépassées avec leur année réelle** (« avant 2020 ⚠️ »)
- **Profil aromatique toujours visible** sur la fiche (plus de dépliant), radar aux **axes adaptatifs par couleur de vin**, polygone à la couleur du type
- **Surbrillance** : ouvrir la fiche d'un vin quitte la surbrillance en cours (c'était la seule sortie manquante)
- **Superposition en pyramide** : les couches supérieures reposent dans les creux (décalage d'un demi-entraxe), silhouettes des emplacements vides atténuées
- **Rails 3D alignés** entre casiers de largeurs différentes ; sous-menus « Un plat / Menu complet » et « Conseil d'achat / Opportunité » au format standard
- **Appareil photo** : `getUserMedia` tenté sur tous les appareils, messages de diagnostic explicites (HTTP non sécurisé / permission refusée) avant le repli galerie

### [7.0.0] — 2026-07
Version majeure : sommelier IA complet + refonte mobile. Merci à **Pulpyyyy** (PR #6, portée et fusionnée) et **aldoushx** (concepts sommelier de ha-cellier-ia, réimplémentés — prompts et code réécrits, aucune consultation de site externe).

- **Sommelier IA** : accord sur le repas complet (3 champs Entrée/Plat/Dessert, 1-2 bouteilles de la cave choisies, surbrillance dans la cave), conseil d'achat (audit + 5 suggestions sous budget/région), analyse d'opportunité en magasin (avec scan d'étiquette réutilisé). Nouvelle fenêtre 🧠 Sommelier dans ⚙️ Options
- **Profil aromatique** : 11 familles par vin (rempli par « Compléter les fiches »), graphique radar ou barres au choix (réglage dans ⚙️ Options), section repliable dans la fiche
- **IA automatique dans les accords** : plus de bouton « Affiner » — le résultat local s'affiche instantanément et l'IA l'affine dans la foulée (interrupteur dans ⚙️ Options)
- **Fenêtre de progression IA universelle** : étapes nommées, tokens de l'appel + cumul du jour (compteur remis à zéro à minuit, visible dans ⚙️ Options)
- **Apogée** : fenêtres resserrées par le prompt IA (largeur réaliste selon le potentiel de garde, jamais plus de 12 ans d'écart) ; nouvelle option « Resserrer les fenêtres trop larges » dans Compléter les fiches pour corriger les vins déjà enregistrés ; états corrigés (fin de fenêtre proche = à boire en priorité), top 10, graphique de garde en segments dans un dépliant
- **Mobile (PR #6)** : glisser-déposer tactile, permutation atomique `swap_slots` (cave pleine OK), responsive container queries, typo fluide, récupération WebGL, rotation d'écran
- Nouveaux websockets `pair_menu`, `audit_cellar`, `opportunity`, `ai_usage` ; nouveau service `swap_slots` ; `refresh_wines` et `import_vinotag` désormais documentés dans `services.yaml`

### [6.9.3] — 2026-07
Correctif d'affichage de la fenêtre Options.

- **Tuile « Repères 3D » décalée à droite** : le modal (monté hors shadow root) n'avait pas de règle `box-sizing` universelle — les `<div>` en `width:100%` + padding débordaient à droite, contrairement aux `<button>`. Règle `box-sizing:border-box` scopée au modal + explicite sur les tuiles, débordement horizontal verrouillé (`overflow-x:hidden`) ; corrige aussi le même défaut latent dans la fenêtre « Gérer les caves »
- **Mise en forme de la tuile Repères 3D** : le sélecteur Étiquette/Bulle/Les deux occupe désormais toute la largeur de la tuile, sous le titre, au lieu d'être indenté sous le texte

### [6.9.1] — 2026-07
Multi-caves, disposition « Superposition », refonte des accords mets/vin.

- **Multi-caves** : plusieurs caves dans la même instance HA, migration automatique de la cave existante. Sélecteur dans l'en-tête, fenêtre « Gérer les caves » dans ⚙️ Options, option YAML `cellar_id`, capteurs T°/hygro et historique de valeur **par cave**, capteurs HA par cave créés dynamiquement. Nouveaux services `add_cellar` / `remove_cellar`
- **Disposition « Superposition »** : 2 à 4 niveaux de bouteilles par clayette (capacité = colonnes × étagères × niveaux), rendu 3D avec une planche par étagère physique et libellés `ét. X · niv. Y · n°Z`
- **Accords mets/vin refondus** : famille « Styles de cuisine » supprimée, combinaisons génériques remplacées par ~75 **pièces de boucherie nommées** (côte de bœuf, onglet, hampe, araignée, pluma, souris d'agneau…) dans 6 nouvelles catégories, **tri alphabétique** des catégories et des plats — 913 plats au total
- **Fenêtre Options harmonisée** : le sélecteur des Repères 3D est intégré à sa tuile, plus de débordement sur mobile
- **Correctifs** : appareil photo Android — repli `getUserMedia` (la carte ouvre elle-même la caméra dans un modal si la WebView ignore l'attribut `capture`, issue #7) ; le choix des capteurs n'est plus écrasé par le service suivant (cache mémoire synchronisé) ; les capteurs HA bouteilles/valeur/casiers lisaient des clés obsolètes et retournaient 0

### [6.9.0] — 2026-07
Fenêtre Options, vue 3D par défaut, carte pleine largeur, appareil photo Android et 1000+ accords.

- **Fenêtre Options dédiée** : le menu repliable sous l'en-tête est remplacé par une vraie fenêtre (bouton ⚙️) regroupant Compléter les fiches, Capteurs, Import et Repères 3D. La barre de progression de la complétion s'affiche désormais sous l'en-tête de la carte
- **Vue 3D par défaut** : à la première installation, la carte s'ouvre en vue 3D. La dernière vue choisie reste bien sûr mémorisée
- **Carte pleine largeur** : dans le tableau de bord (disposition « sections »), la carte occupe désormais toute la largeur par défaut et reste redimensionnable (minimum 6 colonnes) — bien plus confortable sur PC
- **Appareil photo sur Android (correctif)** : le bouton « 📷 Prendre une photo » ouvrait la pellicule au lieu de l'appareil photo. Les entrées de capture sont désormais créées statiquement, ce que toutes les WebView Android respectent
- **Accords mets/vin : plus de 1000 plats** : la bibliothèque passe à **1011 plats** répartis en 34 catégories (gibier, fromages nommés, poissons par cuisson, fruits, apéritif, cuisines du monde, desserts…), générés avec des profils de vin cohérents. Le nombre exact est affiché dans l'onglet Accords. La recherche libre et le renfort IA restent disponibles

### [6.8.1] — 2026-06
Correctif de versioning.

- **Version affichée** : `manifest.json` était resté en retard sur le tag de release, la page Appareils de HA affichait une version différente de HACS (merci @chris94440 pour le signalement, issue #7). Ajouté à la checklist de publication

### [6.8.0] — 2026-06
Correction de la vue 3D et appareil photo direct sur mobile.

- **Vue 3D après un changement de vue Lovelace (fond noir)** : la carte remontait un fond noir au retour d'une subview, car la vue 3D était démontée au détachement sans jamais être reconstruite au retour. La carte détecte désormais son ré-attachement, se réabonne aux mises à jour et remonte la vue 3D automatiquement (merci @mrgrlscz pour le signalement)
- **Appareil photo direct sur mobile** : sur téléphone, le scan d'étiquette propose désormais « 📷 Prendre une photo » (ouvre directement l'appareil photo) ou « 🖼️ Galerie ». Le bloc photo du formulaire offre les deux mêmes boutons. Sur ordinateur, comportement inchangé (merci @chris94440 pour la suggestion)
- **Fiabilisation** : désabonnements nettoyés au détachement (plus de doublons), montage 3D annulé si la carte est détachée pendant le chargement, écouteur de pointeur attaché une seule fois

---

## ❤️ Soutenir le projet

Millésime est gratuit et open source. Si l'intégration vous plaît, vous pouvez [**offrir un verre de vin** 🍷](https://paypal.me/Redsklns).

---

## 🙏 Crédits

Icônes des boutons (tire-bouchon, bouteille, bouchon, nœud papillon, grappe, verre) : [game-icons.net](https://game-icons.net) — créées par **Delapouite** et **Lorc**, licence [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## 📄 Licence

Projet open source — voir le fichier [LICENSE](LICENSE).
