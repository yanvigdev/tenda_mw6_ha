# Home Assistant integration — Tenda Nova MW6 (serial-number authentication)

*English · [Français](README.fr.md)*

Fork of [`kamiljaworski88/tenda_mw6_ha`](https://github.com/kamiljaworski88/tenda_mw6_ha).

This fork replaces the original authentication (a 32 hex-character "account",
which required a **packet capture** of the official app's traffic) with a much
simpler method validated on real hardware: a node's **serial number**, placed in
the `qrmsg` field of the login message. The serial number is printed under each
unit and encoded in its QR code — **so no capture is needed**.

The integration stays **local and read-only**: it sends no configuration command
to the router and uses no Tenda cloud service.

## Purpose

Monitor the Tenda Nova MW6 mesh without the mobile app: connected devices,
online/offline state, Wi-Fi signal strength, per-client up/down rates and
accumulated transfer — all inside Home Assistant, with a bundled Lovelace card.

## Requirements

- A Home Assistant instance (tested on a recent containerized install).
- The MW6 units and Home Assistant on the **same network**.
- The **master node IP**: the only node exposing TCP port 9000. Find it by
  looking for the open port 9000 (e.g. `192.168.0.1`).
- A node's **serial number** (label under the unit, or QR code,
  e.g. `E00000000000000000`). Any serial from the mesh works.

## Installation

1. Copy the `custom_components/tenda_mw6/` folder into Home Assistant's
   `config/custom_components/` folder.
2. Restart Home Assistant.
3. **Settings → Devices & services → Add integration → Tenda MW6**.
4. Fill in:
   - **Host**: master node IP (e.g. `192.168.0.1`);
   - **Port**: `9000`;
   - **Serial number**: a node's serial (no spaces).

> Command-line deployment (when `custom_components` is owned by root):
> ```bash
> tar czf /tmp/tenda.tgz -C custom_components tenda_mw6
> scp /tmp/tenda.tgz <host>:/tmp/
> ssh <host> 'docker exec -i homeassistant sh -c \
>   "rm -rf /config/custom_components/tenda_mw6 && tar xzf - -C /config/custom_components" < /tmp/tenda.tgz'
> # then restart HA (homeassistant.restart service)
> ```

## Configuration

| Field | Role | Example |
|-------|------|---------|
| `host` | Master node IP (port 9000) | `192.168.0.1` |
| `port` | Local service port | `9000` |
| `serial` | A node's serial number (`qrmsg` field) | `E00000000000000000` |

The integration **options** (Settings → Devices & services → Tenda MW6 →
Configure) hold two settings; saving them reloads the integration:

- **Device names**: an `IP | MAC = name` mapping.
- **Signal hysteresis** (dBm, default **2**, 0 to 10): radio noise moves a steady
  client's signal by 1-2 dBm between polls, and Home Assistant stores every change.
  A client Signal sensor only changes when the measurement differs from the displayed
  value by more than this many dBm. On a real mesh, 2 removed about 70 % of these
  writes; the displayed value may then be up to 2 dBm off. `0` disables it. Losing or
  regaining a signal is always shown at once; node sensors keep the exact value. The
  topology card's median reads the client sensors, so it follows the smoothed values.

## The Lovelace card

The `custom:tenda-mw6-card` card is bundled with the integration. It lists the
devices with sorting, a transfer-period selector and a unit selector.

The integration tries to load the card automatically (`add_extra_js_url`).
**If the card does not appear** in the picker or raises "Custom element not
found: tenda-mw6-card", declare it explicitly as a Lovelace resource (the
reliable, recommended method):

- **Settings → Dashboards → ⋮ → Resources → Add resource**
  - URL: `/tenda_mw6/tenda-mw6-card.js`
  - Type: **JavaScript Module**

then reload the frontend (Ctrl+Shift+R). Add the card via "Add card" →
*Tenda MW6 Devices Card*, or manually:

```yaml
type: custom:tenda-mw6-card
```

## The topology card

Each mesh node is exposed as a Home Assistant device ("Tenda MW6 node …1234") with
three sensors: connected clients, Wi-Fi clients and weakest signal. They are computed
from the client list only; no extra command is sent to the nodes. Rename each node and
assign it an area from **Settings → Devices & services → Devices**: the card uses that
name and area.

A node is discovered through its clients: a node that never carried a client does not
appear until it does.

```yaml
type: custom:tenda-mw6-topology-card
title: Mesh Wi-Fi            # optional
entry_id: abc123             # optional, when several meshes are configured
weak_signal_threshold: -70   # optional, dBm
```

The card shows one column per node (sorted by area, then name) with its clients: green
dot at -60 dBm or better, orange below, red at or below the threshold, network icon for
wired clients. Each node header also shows the **median signal** of its online Wi-Fi
clients, with the dot of its level; it describes the whole node and ignores the toggles,
like the online count (with an even count, the mean of the two middle values is rounded
toward the weaker signal).

Toggles, remembered per browser: "Offline", "Weak signal only", and the two exclusive
connection filters "Wired only" / "Wireless only" (checking one clears the other). An
offline client reports no signal, so its connection type is unknown and both connection
filters hide it. Clients whose node is unknown are grouped under "No node". Click a
client or a node to open its details.

If the card is reported as "Custom element not found: tenda-mw6-topology-card", declare
it as a Lovelace resource: URL `/tenda_mw6/tenda-mw6-topology-card.js?v=2`, type
**JavaScript Module**.

## Exposed entities

Per client device: online state, Wi-Fi signal, IP address, attached node and
connection type (`wifi` / `wired`, an ENUM sensor). The firmware leaves its
`access` field empty, so the type is derived from the signal: a client reporting
one is on Wi-Fi, an online client without one is wired, an offline client is
unknown.

Also per client, **disabled by default**: up/down rate and accumulated transfer
(total/day/month). A mesh in bridge mode reports a zero rate for every client,
and six transfer sensors per client feeding long-term statistics with zeros was
the main database cost of the integration. Enable them from the entity settings
when `Transfer counting health` reports `rate_observed`.

At the mesh level: inventory summary, transfer-counting health, aggregate rates
and transfers (disabled by default, same reason), and — as diagnostics — the
**global QoS caps** (`QoS upload cap` / `QoS download cap`, read-only
`QOS_GET`; raw values, unit unconfirmed).

Per mesh node (one device per node): connected clients (with the total in
attributes), Wi-Fi clients and weakest signal (with the client concerned in
attributes), all derived from the client list.

Entity ids of clients discovered since 2.2.0 are prefixed
`sensor.tenda_mw6_<name>_<metric>` (and `binary_sensor.tenda_mw6_<name>_online`)
so they never collide with entities of another integration named after the same
device (the companion app also creates `sensor.<phone>_connection_type`). Ids
already in the registry are kept.

Entity attributes only carry values that change when the client changes
(address, name, node, connection type): a value rewritten on every poll would
make the recorder store one state row per poll and per entity.

### Removing a device the mesh no longer reports

A client that left (a phone, a replaced board) or a node seen as a client during
setup keeps its device, with unavailable entities. Open the device page in Home
Assistant and use **Delete**: the integration accepts the removal of any client
or node absent from the last poll, and refuses the hub and present devices.

### Upgrading to 2.2.0

On the first start the config entry is migrated (schema 3.2): rate and transfer
entities still enabled are disabled by the integration (entities you disabled
yourself are left alone); you may re-enable any of them. Their past statistics
are not deleted: use `recorder.clear_statistics` (Developer tools → Actions) or
the **Fix issue** prompts of the statistics page if you want to reclaim the space.

## Architecture

- `custom_components/tenda_mw6/api.py`: TCP/9000 client (read-only).
  `build_login_payload()` encodes the serial number into the `qrmsg` field
  (protobuf field 2); `get_clients()` chains `GET_STA` → `LOGIN` →
  `MESH_HOSTS_GET` and decodes the host list.
- `config_flow.py`: input and validation (host, port, serial number).
- `coordinator.py`: periodic polling, every 60 s (`UPDATE_INTERVAL`); transfer counters skip gaps longer than three periods.
- `sensor.py` / `binary_sensor.py` / `select.py`: exposed entities.
- `entity_naming.py`: entity id prefix, rate/transfer policy and removable-device
  rule (pure Python, unit tested); `node_identity.py`: node device identifiers.
- `tenda-mw6-card.js`: Lovelace card (device list).
- `tenda-mw6-topology-card.js`: Lovelace topology card (one column per node).

## Protocol (recap)

Frame: `24 00 07 TT 00 d5 LLLL MM CC 00 00 01 00 00 00 [payload]`
(responses use `kind = 0x06`). Authentication: module `0x18`, `LOGIN` command
(`0x01`), payload `12 <len> <ASCII serial>`. Read: module `0x14`, command `0x00`
(`MESH_HOSTS_GET`).

## Tests

```bash
python3 -m unittest discover -s tests   # API/node id unit tests + doctests
node tests/test_card.js              # Lovelace card logic
node tests/test_topology_card.js     # topology card model and rendering
```

GitHub Actions runs these checks on every push and pull request
(`.github/workflows/python-smoke.yml`), plus a HACS validation
(`validate-hacs.yml`).

A real integration test (serial login + client read) was validated against the
local master node.

## Security and limitations

- Read-only: no write command is sent to the router.
- The serial number alone authenticates locally: anyone who knows it (it is
  visible under the unit) can read the local network inventory.
- Protocol validated on firmware returning `GET_STA = 000000000803`
  (compatible with `V1.0.0.32(9821)` from the original reverse engineering).

## Credits

Reverse engineering and integration base: `kamiljaworski88/tenda_mw6_ha` and
`latonita/tenda-reverse`. This fork adds serial-number authentication.
