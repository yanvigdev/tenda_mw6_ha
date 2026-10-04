# AGENTS.md — Tenda MW6 Home Assistant integration fork

Fork of `kamiljaworski88/tenda_mw6_ha`. Fork goal: local authentication via a
**serial number** (`qrmsg` field of the TCP/9000 LoginMsg) instead of the 32-hex
"account", to avoid any packet capture. The integration is **local, read-only**.

## Structure

- `custom_components/tenda_mw6/`: the HA component.
  - `api.py`: TCP/9000 client. `build_login_payload(serial)` → `12 <len> <serial>`;
    `TendaMW6Api.get_clients()` → `GET_STA` (0x18/0x00) → `LOGIN` (0x18/0x01) →
    `MESH_HOSTS_GET` (0x14/0x00). `get_qos()` → `QOS_GET` (0x17/0x08), read-only.
    `SERIAL_RE` validates the serial (`^[0-9A-Za-z]{6,32}$`).
  - `__init__.py`: `CONF_SERIAL = "serial"`. Config schema **version 3**.
    `async_migrate_entry` refuses v1/v2 (no conversion to a serial is possible).
  - `config_flow.py`: host / port / serial input, with real validation.
  - `coordinator.py`: client poll every 60 s (`UPDATE_INTERVAL`, raised from 10 s
    to limit HA recorder writes) + best-effort QoS read (a QoS failure never
    fails the client poll). `MAX_TRANSFER_SAMPLE_GAP_SECONDS` (3 periods) bounds
    the rate-integration gap of the transfer sensors: keep it tied to the period.
  - `sensor.py`, `binary_sensor.py`, `select.py`.
  - `tenda-mw6-card.js`: Lovelace card (English labels, hardcoded).
  - `tenda-mw6-topology-card.js`: topology card (one column per node). Pure model
    (`mw6tBuildTopology`, `mw6tSignalLevel`, ...) exported via `module.exports` for
    Node tests; labels EN/FR/PL from `hass.language`. Both card files are served by
    `__init__.py` (`FRONTEND_FILES`).
  - Node devices: `api.summarize_nodes()` → `coordinator.node_summaries` →
    `sensor.py` `TendaMW6Node*Sensor` (device id `(DOMAIN, f"{entry_id}:node:{sn}")`
    built by `node_identity.py`; parent hub set with `via_device_id` on the
    device registry, since `DeviceInfo.via_device` is deprecated). Derived from the client list
    only. At setup, node devices already in the registry are recreated first, so a
    node without clients keeps its entities across restarts.
  - `translations/`: `en.json`, `fr.json`, `pl.json`; `strings.json` = English
    source. Entity names and sort-option labels are localized here
    (`entity.select.*`).
- `tests/test_api.py` (Python unittest), `tests/test_card.js` and
  `tests/test_topology_card.js` (Node).

## Commands

```bash
python3 -m unittest tests.test_api                     # API tests
# Doctests of api.py / node_identity.py run inside unittest (load_tests). Do not use
# `python -m doctest <file>`: it puts the package dir on sys.path and select.py
# shadows the stdlib `select` module (fails on Python 3.12).
node tests/test_card.js                                # card logic
node tests/test_topology_card.js                       # topology card
python3 -m unittest tests.test_node_identity           # node device identifiers
node -c custom_components/tenda_mw6/tenda-mw6-card.js  # JS syntax check
```

CI (GitHub Actions, free on this public fork): `.github/workflows/python-smoke.yml`
runs all of the above on every push/PR touching code or tests;
`validate-hacs.yml` validates the HACS layout. Keep the workflow in sync when
adding a test file or a card.

## Deployment (containerized Home Assistant)

- Copy `custom_components/tenda_mw6/` into HA's `config/custom_components/`.
  If that folder is owned by **root** (HA in a container), use `docker exec`:
  `docker exec -i homeassistant sh -c "tar xzf - -C /config/custom_components" < archive`.
- Restart Home Assistant (`homeassistant.restart` service or the UI).
- Create the entry via the UI (Settings → Devices & services → Tenda MW6) or,
  without the UI, via the REST config flow (`POST /api/config/config_entries/flow`
  with handler `tenda_mw6`, then submit `host`/`port`/`serial`).

## Conventions

- Prose (docs, comments, docstrings) in **English**, matching the upstream
  project. A French README is provided as `README.fr.md`. Docstrings on public
  units.
- Card internal values (`device`, `ip`, `download`, `upload`, `total`, `day`,
  `month`, `MB`, `GB`): **do not translate** (logic / localStorage keys); only
  visible labels are text.
- Read-only only: never send a write/bind/set command to the router.
- Topology card: every top-level identifier is prefixed `mw6t` / `MW6T_`. HA loads
  both cards as ES modules (separate scopes); the prefix guards against a classic
  script load, where a duplicated top-level `const` would throw. Node sensors carry `tenda_mw6_node: true`, `tenda_mw6_metric`
  (`node_online` / `node_wifi` / `node_weakest_signal`), `node_sn`,
  `config_entry_id`: the card discovers nodes through these, not entity ids.

## Protocol reference

- Frame: `24 00 07 TT 00 d5 LLLL MM CC 00 00 01 00 00 00 [payload]`; responses
  use `kind = 0x06`.
- Auth: module `0x18`, `LOGIN` (0x01), payload `12 <len> <ASCII serial>`.
- Reads: `MESH_HOSTS_GET` (0x14/0x00), `QOS_GET` (0x17/0x08). Do not brute-force
  command ids; only use confirmed, observed read operations.
