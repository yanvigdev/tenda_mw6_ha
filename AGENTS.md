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
  - `coordinator.py`: client poll + best-effort QoS read (a QoS failure never
    fails the client poll).
  - `sensor.py`, `binary_sensor.py`, `select.py`.
  - `tenda-mw6-card.js`: Lovelace card (English labels, hardcoded).
  - `translations/`: `en.json`, `fr.json`, `pl.json`; `strings.json` = English
    source. Entity names and sort-option labels are localized here
    (`entity.select.*`).
- `tests/test_api.py` (Python unittest), `tests/test_card.js` (Node).

## Commands

```bash
python3 -m unittest tests.test_api                     # API tests
python3 -m doctest custom_components/tenda_mw6/api.py  # doctests
node tests/test_card.js                                # card logic
node -c custom_components/tenda_mw6/tenda-mw6-card.js  # JS syntax check
```

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

## Protocol reference

- Frame: `24 00 07 TT 00 d5 LLLL MM CC 00 00 01 00 00 00 [payload]`; responses
  use `kind = 0x06`.
- Auth: module `0x18`, `LOGIN` (0x01), payload `12 <len> <ASCII serial>`.
- Reads: `MESH_HOSTS_GET` (0x14/0x00), `QOS_GET` (0x17/0x08). Do not brute-force
  command ids; only use confirmed, observed read operations.
