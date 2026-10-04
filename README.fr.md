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

## Entités exposées

Par appareil client : état en ligne, signal Wi-Fi, débit montant/descendant,
transfert cumulé (total/jour/mois), adresse IP, nœud de rattachement et type de
connexion (filaire/Wi-Fi).

Au niveau du mesh : synthèse d'inventaire, santé du comptage de transfert,
débits agrégés, transferts agrégés, et — en diagnostic — les **plafonds QoS
globaux** (`QoS upload cap` / `QoS download cap`, lecture seule `QOS_GET` ;
valeurs brutes, unité non confirmée).

## Architecture

- `custom_components/tenda_mw6/api.py` : client TCP/9000 (lecture seule).
  `build_login_payload()` encode le numéro de série dans le champ `qrmsg`
  (protobuf champ 2) ; `get_clients()` enchaîne `GET_STA` → `LOGIN` →
  `MESH_HOSTS_GET` et décode la liste des hôtes.
- `config_flow.py` : saisie et validation (hôte, port, numéro de série).
- `coordinator.py` : sondage périodique.
- `sensor.py` / `binary_sensor.py` / `select.py` : entités exposées.
- `tenda-mw6-card.js` : carte Lovelace.

## Protocole (rappel)

Trame : `24 00 07 TT 00 d5 LLLL MM CC 00 00 01 00 00 00 [payload]`
(réponses avec `kind = 0x06`). Authentification : module `0x18`, commande
`LOGIN` (`0x01`), charge `12 <len> <SN ASCII>`. Lecture : module `0x14`,
commande `0x00` (`MESH_HOSTS_GET`).

## Tests

```bash
python3 -m unittest tests.test_api   # tests unitaires de l'API
node tests/test_card.js              # logique de la carte Lovelace
```

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
