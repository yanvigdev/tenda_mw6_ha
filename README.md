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

Device names can be customized through the integration **options**
(`IP | MAC = name` mapping).

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

## Exposed entities

Per client device: online state, Wi-Fi signal, up/down rate, accumulated
transfer (total/day/month), IP address, attached node and connection type
(wired/Wi-Fi).

At the mesh level: inventory summary, transfer-counting health, aggregate rates,
aggregate transfers, and — as diagnostics — the **global QoS caps**
(`QoS upload cap` / `QoS download cap`, read-only `QOS_GET`; raw values, unit
unconfirmed).

## Architecture

- `custom_components/tenda_mw6/api.py`: TCP/9000 client (read-only).
  `build_login_payload()` encodes the serial number into the `qrmsg` field
  (protobuf field 2); `get_clients()` chains `GET_STA` → `LOGIN` →
  `MESH_HOSTS_GET` and decodes the host list.
- `config_flow.py`: input and validation (host, port, serial number).
- `coordinator.py`: periodic polling.
- `sensor.py` / `binary_sensor.py` / `select.py`: exposed entities.
- `tenda-mw6-card.js`: Lovelace card.

## Protocol (recap)

Frame: `24 00 07 TT 00 d5 LLLL MM CC 00 00 01 00 00 00 [payload]`
(responses use `kind = 0x06`). Authentication: module `0x18`, `LOGIN` command
(`0x01`), payload `12 <len> <ASCII serial>`. Read: module `0x14`, command `0x00`
(`MESH_HOSTS_GET`).

## Tests

```bash
python3 -m unittest tests.test_api   # API unit tests
node tests/test_card.js              # Lovelace card logic
```

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
