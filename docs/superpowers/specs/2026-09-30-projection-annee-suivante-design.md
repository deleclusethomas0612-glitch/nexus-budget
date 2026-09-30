# Projection du dashboard : bascule année en cours / année suivante

## Besoin

En fin d'année, visualiser les soldes projetés de l'année suivante sur le graphe du dashboard.

## Design retenu (approche A : bascule d'année)

### UI
- Deux puces au-dessus du graphe : année en cours (`Y`) et `Y + 1`, dérivées de la date du jour.
- Style émeraude, même patron que les puces Mensualités / Propriété (Immobilier).
- State `projYear`, **non persisté** : défaut = année en cours à chaque ouverture.
- Mise en avant du mois courant (graissage + dégradé `gNow`) uniquement sur l'année en cours.

### Calcul
Le bloc projection de `totals` devient `buildProjection(Y)` ; `totals.projections` = `{ [Y]: [...12 mois], [Y+1]: [...12 mois] }`.

Pour une année `Y` :
- Dépense / recette datée (`flowOn`) **avant Y** ou non datable → acquise dès janvier ; **en Y** → sur son mois ; **après Y** → hors graphe.
- Échéance armée (`dueList`) **en Y** → segment rouge sur son mois ; **avant Y** → considérée comme déjà sortie (déduite dès janvier) ; **après Y** → ignorée.
- Provisions : cumul continu `accProvisionAt(absMonth(Y, i))`, inchangé.
- Avances en cours : déduites sur chaque mois, inchangé.

### Hors périmètre
- **Aucune estimation automatique** des charges annuelles sans échéance saisie : l'utilisateur arme lui-même ses échéances de `Y + 1` (calendrier des provisions ou « Prélèvement à venir »). La courbe `Y + 1` ne reflète que ce qui est saisi.
- `realCash`, virement, provision mensuelle : inchangés.

### Non-régression
Barres de l'année en cours identiques : même formule avec `Y = année en cours`. Seule différence théorique : une échéance d'une année passée encore armée serait désormais déduite dès janvier (cas impossible en pratique, le balayage du jour J les retire).

### Vérification
- `npm run lint` + `npm run build` à zéro.
- Continuité : `avant(Jan Y+1)` = `solde(Déc Y)` + un mois de provision (+ recettes / − dépenses datées de janvier Y+1).
