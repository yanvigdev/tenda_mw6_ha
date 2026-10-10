# Intégration Home Assistant — Tenda Nova MW6 (authentification par numéro de série)

*[English](README.md) · Français*

Fork de [`kamiljaworski88/tenda_mw6_ha`](https://github.com/kamiljaworski88/tenda_mw6_ha).

Ce fork remplace l'authentification d'origine (« account » de 32 caractères
hexadécimaux, qui imposait une **capture réseau** du trafic de l'application
officielle) par une méthode beaucoup plus simple et validée sur le parc réel :
le **numéro de série** d'un nœud, placé dans le champ `qrmsg` du message de
connexion. Le numéro de série est imprimé sous chaque borne et contenu dans son
QR code — **aucune capture n'est donc nécessaire**.

L'intégration reste **locale et en lecture seule** : elle n'envoie aucune commande
de configuration à la borne et n'utilise aucun service cloud Tenda.

## But

Superviser l'activité du mesh Tenda Nova MW6 sans l'application mobile :
appareils connectés, état en ligne/hors ligne, puissance du signal Wi-Fi,
débits montant/descendant par client et transfert cumulé — le tout dans Home
Assistant, avec une carte Lovelace fournie.

## Prérequis

- Une instance Home Assistant (testé sur une installation conteneurisée récente).
- Les bornes MW6 et Home Assistant sur le **même réseau**.
- L'**IP du nœud maître** : c'est le seul nœud qui expose le port TCP/9000.
  On le repère en cherchant le port 9000 ouvert (ex. `192.168.0.1`).
- Le **numéro de série** d'un nœud (étiquette sous la borne ou QR code,
  ex. `E00000000000000000`). N'importe quel SN du mesh fonctionne.

## Installation

1. Copier le dossier `custom_components/tenda_mw6/` dans le dossier
   `config/custom_components/` de Home Assistant.
2. Redémarrer Home Assistant.
3. **Paramètres → Appareils et services → Ajouter une intégration → Tenda MW6**.
4. Renseigner :
   - **Hôte** : IP du nœud maître (ex. `192.168.0.1`) ;
   - **Port** : `9000` ;
   - **Numéro de série** : le SN d'un nœud (sans espaces).

> Déploiement en ligne de commande (dossier `custom_components` appartenant à root) :
> ```bash
> tar czf /tmp/tenda.tgz -C custom_components tenda_mw6
> scp /tmp/tenda.tgz <hôte>:/tmp/
> ssh <hôte> 'docker exec -i homeassistant sh -c \
>   "rm -rf /config/custom_components/tenda_mw6 && tar xzf - -C /config/custom_components" < /tmp/tenda.tgz'
> # puis redémarrer HA (service homeassistant.restart)
> ```

## Configuration

| Champ | Rôle | Exemple |
|-------|------|---------|
| `host` | IP du nœud maître (port 9000) | `192.168.0.1` |
| `port` | Port du service local | `9000` |
| `serial` | Numéro de série d'un nœud (champ `qrmsg`) | `E00000000000000000` |

Les noms d'appareils peuvent être personnalisés via les **options** de
l'intégration (correspondance `IP | MAC = nom`).

## La carte Lovelace

La carte `custom:tenda-mw6-card` est fournie avec l'intégration. Elle liste les
appareils avec tri, choix de la période de transfert et de l'unité.

L'intégration tente de charger la carte automatiquement (`add_extra_js_url`).
**Si la carte n'apparaît pas** dans le sélecteur ou provoque l'erreur
« Custom element not found: tenda-mw6-card », déclare-la explicitement comme
ressource Lovelace (méthode fiable, recommandée) :

- **Paramètres → Tableaux de bord → ⋮ → Ressources → Ajouter une ressource**
  - URL : `/tenda_mw6/tenda-mw6-card.js`
  - Type : **Module JavaScript**

puis recharge le frontend (Ctrl+Maj+R). Ajoute ensuite la carte via
« Ajouter une carte » → *Tenda MW6 Devices Card*, ou en mode manuel :

```yaml
type: custom:tenda-mw6-card
```

## La carte topologie

Chaque borne du mesh est exposée comme un appareil Home Assistant (« Tenda MW6 node
…1234 ») avec trois capteurs : clients connectés, clients Wi-Fi et signal le plus
faible. Ils sont calculés uniquement à partir de la liste des clients ; aucune commande
supplémentaire n'est envoyée aux bornes. Renommez chaque borne et attribuez-lui une
pièce dans **Paramètres → Appareils et services → Appareils** : la carte reprend ce nom
et cette pièce.

Une borne est découverte à travers ses clients : une borne qui n'a jamais porté de
client n'apparaît pas tant que ce n'est pas le cas.

```yaml
type: custom:tenda-mw6-topology-card
title: Mesh Wi-Fi            # optionnel
entry_id: abc123             # optionnel, si plusieurs mesh sont configurés
weak_signal_threshold: -70   # optionnel, en dBm
```

La carte affiche une colonne par borne (triées par pièce puis par nom) avec ses
clients : pastille verte à −60 dBm ou mieux, orange en dessous, rouge au seuil ou en
dessous, icône réseau pour les clients filaires. L'en-tête de chaque borne affiche aussi
le **signal médian** de ses clients Wi-Fi en ligne, avec la pastille de son niveau ; il
décrit toute la borne et ignore les filtres, comme le compteur « en ligne » (pour un
nombre pair, la moyenne des deux valeurs centrales est arrondie vers le signal le plus
faible).

Interrupteurs, mémorisés par navigateur : « Hors ligne », « Signal faible seulement »,
et les deux filtres de connexion exclusifs « Filaire seulement » / « Sans fil
seulement » (en cocher un décoche l'autre). Un client hors ligne ne rapporte pas de
signal : son type de connexion est inconnu et les deux filtres de connexion le masquent.
Les clients dont la borne est inconnue sont regroupés sous « Sans borne ». Un clic sur
un client ou une borne ouvre sa fiche.

Si la carte est signalée « Custom element not found: tenda-mw6-topology-card »,
déclarez-la comme ressource Lovelace : URL `/tenda_mw6/tenda-mw6-topology-card.js?v=2`,
type **Module JavaScript**.

## Entités exposées

Par appareil client : état en ligne, signal Wi-Fi, adresse IP, nœud de
rattachement et type de connexion (`wifi` / `wired`, capteur ENUM). Le firmware
laisse son champ `access` vide : le type est déduit du signal — un client qui en
rapporte un est en Wi-Fi, un client en ligne sans signal est filaire, un client
hors ligne est inconnu.

Également par client, **désactivés par défaut** : débit montant/descendant et
transfert cumulé (total/jour/mois). Un mesh en mode pont renvoie un débit nul
pour tous les clients, et six capteurs de transfert par client alimentant les
statistiques long terme de zéros étaient le principal coût de l'intégration en
base de données. Activez-les depuis les réglages de l'entité quand
`Transfer counting health` affiche `rate_observed`.

Au niveau du mesh : synthèse d'inventaire, santé du comptage de transfert,
débits et transferts agrégés (désactivés par défaut, même raison), et — en
diagnostic — les **plafonds QoS globaux** (`QoS upload cap` /
`QoS download cap`, lecture seule `QOS_GET` ; valeurs brutes, unité non
confirmée).

Par borne du mesh (un appareil par borne) : clients connectés (total en
attribut), clients Wi-Fi et signal le plus faible (client concerné en attribut),
tous déduits de la liste des clients.

Les identifiants des clients découverts depuis la 2.2.0 sont préfixés
`sensor.tenda_mw6_<nom>_<mesure>` (et `binary_sensor.tenda_mw6_<nom>_online`)
pour ne jamais entrer en collision avec les entités d'une autre intégration
nommées d'après le même appareil (l'application compagnon crée aussi
`sensor.<téléphone>_connection_type`). Les identifiants déjà au registre sont
conservés.

Les attributs des entités ne portent que des valeurs qui changent quand le
client change (adresse, nom, borne, type de connexion) : une valeur réécrite à
chaque relevé ferait écrire au recorder une ligne d'état par relevé et par entité.

### Supprimer un appareil que le mesh ne rapporte plus

Un client parti (un téléphone, une carte remplacée) ou une borne vue comme
client pendant l'installation garde son appareil, avec des entités
indisponibles. Ouvrez la fiche de l'appareil dans Home Assistant et utilisez
**Supprimer** : l'intégration accepte la suppression de tout client ou borne
absent du dernier relevé, et refuse le hub et les appareils présents.

### Mise à niveau vers la 2.2.0

Au premier démarrage, l'entrée de configuration est migrée (schéma 3.2) : les
entités de débit et de transfert encore actives sont désactivées par
l'intégration (celles que vous aviez désactivées vous-même ne sont pas
touchées) ; vous pouvez en réactiver à volonté. Leurs statistiques passées ne
sont pas effacées : utilisez `recorder.clear_statistics` (Outils de
développement → Actions) ou les propositions de correction de la page des
statistiques si vous voulez récupérer l'espace.

## Architecture

- `custom_components/tenda_mw6/api.py` : client TCP/9000 (lecture seule).
  `build_login_payload()` encode le numéro de série dans le champ `qrmsg`
  (protobuf champ 2) ; `get_clients()` enchaîne `GET_STA` → `LOGIN` →
  `MESH_HOSTS_GET` et décode la liste des hôtes.
- `config_flow.py` : saisie et validation (hôte, port, numéro de série).
- `coordinator.py` : sondage périodique, toutes les 60 s (`UPDATE_INTERVAL`) ; les compteurs de transfert ignorent un écart de plus de trois périodes.
- `sensor.py` / `binary_sensor.py` / `select.py` : entités exposées.
- `entity_naming.py` : préfixe des identifiants, politique débit/transfert et
  règle des appareils supprimables (Python pur, testé unitairement) ;
  `node_identity.py` : identifiants des appareils « borne ».
- `tenda-mw6-card.js` : carte Lovelace.

## Protocole (rappel)

Trame : `24 00 07 TT 00 d5 LLLL MM CC 00 00 01 00 00 00 [payload]`
(réponses avec `kind = 0x06`). Authentification : module `0x18`, commande
`LOGIN` (`0x01`), charge `12 <len> <SN ASCII>`. Lecture : module `0x14`,
commande `0x00` (`MESH_HOSTS_GET`).

## Tests

```bash
python3 -m unittest discover -s tests   # tests unitaires API/identifiants de borne + doctests
node tests/test_card.js              # logique de la carte Lovelace
node tests/test_topology_card.js     # modèle et rendu de la carte topologie
```

GitHub Actions lance ces vérifications à chaque push et pull request
(`.github/workflows/python-smoke.yml`), ainsi qu'une validation HACS
(`validate-hacs.yml`).

Un test d'intégration réel (login par SN + lecture des clients) a été validé
contre le nœud maître local.

## Sécurité et limites

- Lecture seule : aucune commande d'écriture n'est envoyée à la borne.
- Le numéro de série suffit à s'authentifier localement : quiconque le connaît
  (il est visible sous la borne) peut lire l'inventaire réseau en local.
- Protocole validé sur le firmware renvoyant `GET_STA = 000000000803`
  (compatible avec `V1.0.0.32(9821)` de la rétro-ingénierie d'origine).

## Crédits

Rétro-ingénierie et base d'intégration : `kamiljaworski88/tenda_mw6_ha` et
`latonita/tenda-reverse`. Ce fork ajoute l'authentification par numéro de série.
