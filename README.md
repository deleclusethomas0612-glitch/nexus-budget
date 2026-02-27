# Nexus Ultimate Cloud - Architecture des Soldes

## Système de Calcul du Solde (Cash Dispo)

Le **Cash Dispo** visible sur le tableau de bord est un indicateur de trésorerie dynamique. Il ne s'agit pas d'un simple solde bancaire statique, mais d'une projection basée sur les flux suivants :

1. **Le Capital de Référence** : L'application initialise le calcul avec une base fixe (1429€), représentant le point de départ de la trésorerie.
2. **La Puissance des Provisions** : Le système calcule automatiquement une **provision mensuelle** en divisant le total de vos "Provisions Annuelles" (saisies dans l'onglet Charges) par 12. Le solde disponible augmente chaque mois de ce montant (`provision * index_du_mois`), simulant l'accumulation des fonds destinés aux dépenses futures.
3. **Flux de Trésorerie Actifs** : 
   - **Recettes (+)** : S'ajoutent instantanément au solde.
   - **Dépenses (-)** : Se soustraient instantanément.
   - **Avances (Flux) (-)** : Sont déduites du solde dès leur création jusqu'à leur remboursement ou absorption.

## Interconnexion des Modules

- **Tableau de Bord** : Centralise les flux exceptionnels et affiche la projection annuelle (Graphique).
- **Charges Communes** : Pilote le montant de la provision mensuelle. C'est ici que se définit la "vitesse" à laquelle votre solde de provision croît.
- **Mes Charges** : Module de gestion de budget personnel par pointage, indépendant du calcul de trésorerie globale.
- **Épargne** : Gestion isolée des stocks de sécurité. Les mouvements d'épargne n'impactent pas le "Cash Dispo" sauf en cas d'avance spécifique sur compte d'épargne.
- **Historique** : Registre centralisé. Toute modification ou suppression d'une transaction passée recalcule immédiatement le solde disponible sur l'accueil.
