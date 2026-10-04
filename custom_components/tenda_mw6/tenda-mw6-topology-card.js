/**
 * Tenda MW6 Topology Card
 *
 * A dependency-free Lovelace card bundled with the Tenda MW6 integration. It shows one
 * column per mesh node, with the clients each node carries and their signal quality.
 * Nodes are Home Assistant devices: their name and area come from the device registry,
 * so renaming a node or assigning it an area in HA is reflected here.
 *
 * Every top-level identifier is prefixed with mw6t / MW6T_ so this classic script never
 * collides with tenda-mw6-card.js when both are loaded on the same page.
 *
 * Dashboard:
 *   type: custom:tenda-mw6-topology-card
 *   title: Mesh Wi-Fi            # optional
 *   entry_id: abc123             # optional, when several meshes are configured
 *   weak_signal_threshold: -70   # optional, dBm
 */

const MW6T_CARD_VERSION = "1.0.0";
/** Default weak-signal threshold in dBm: a signal at or below it is "weak". */
const MW6T_DEFAULT_WEAK = -70;
/** A signal at or above this value (dBm) is "good". */
const MW6T_GOOD_SIGNAL = -60;

/**
 * Escape a value for safe insertion into HTML text or attributes.
 * Client names come from DHCP and are controlled by the devices themselves.
 * @param {*} value Any value; null and undefined become "".
 * @returns {string} The escaped text.
 */
function mw6tEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convert a value to a finite number.
 * @param {*} value State string or number.
 * @returns {number|null} The number, or null when not finite (e.g. "unknown", "abc").
 */
function mw6tNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Tell whether a Home Assistant state carries a usable value.
 * @param {object} state Home Assistant state object.
 * @returns {boolean} False for unknown/unavailable/none states.
 */
function mw6tAvailable(state) {
  return Boolean(state && !["unknown", "unavailable", "none"].includes(state.state));
}

/**
 * Locale-aware, case-insensitive string comparison with numeric ordering ("node 2" < "node 10").
 * @param {string} left
 * @param {string} right
 * @returns {number} Negative, zero or positive, as for Array.prototype.sort.
 */
function mw6tCompareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Display name of a node: the user's name, then the device name, then the serial tail.
 * @param {object|null} device Device registry entry (hass.devices[id]) or null.
 * @param {string} sn Node serial number.
 * @returns {string}
 */
function mw6tNodeName(device, sn) {
  if (device && device.name_by_user) return device.name_by_user;
  if (device && device.name) return device.name;
  return "…" + String(sn).slice(-4);
}

/**
 * Collect the mesh nodes from their sensors, resolving name and area via the registries.
 * @param {object} states hass.states.
 * @param {object} entities hass.entities (entity registry display entries).
 * @param {object} devices hass.devices.
 * @param {object} areas hass.areas.
 * @param {string|null} entryId Restrict to one config entry, or null for all.
 * @returns {Map<string, object>} Nodes keyed by serial, each with an empty `clients` list.
 */
function mw6tCollectNodes(states, entities, devices, areas, entryId) {
  const nodes = new Map();
  Object.values(states || {}).forEach(function (state) {
    const attrs = state.attributes || {};
    if (attrs.tenda_mw6_node !== true || !attrs.node_sn) return;
    if (entryId && attrs.config_entry_id !== entryId) return;

    if (!nodes.has(attrs.node_sn)) {
      const registryEntry = (entities || {})[state.entity_id] || {};
      const device = registryEntry.device_id ? (devices || {})[registryEntry.device_id] || null : null;
      const area = device && device.area_id ? (areas || {})[device.area_id] || null : null;
      nodes.set(attrs.node_sn, {
        sn: attrs.node_sn,
        name: mw6tNodeName(device, attrs.node_sn),
        area: area ? area.name : "",
        deviceId: registryEntry.device_id || null,
        entityId: null,
        clients: [],
      });
    }
    const node = nodes.get(attrs.node_sn);
    // The "Connected clients" sensor is the click target; any node sensor is a fallback.
    if (attrs.tenda_mw6_metric === "node_online" || !node.entityId) node.entityId = state.entity_id;
  });
  return nodes;
}

/**
 * Collect the clients from their "online" and "signal" entities.
 * A client is wired when it is online and reports no signal.
 * @param {object} states hass.states.
 * @param {string|null} entryId Restrict to one config entry, or null for all.
 * @returns {object[]} Clients: { mac, name, ip, nodeSn, online, signal, wired, entityId }.
 */
function mw6tCollectClients(states, entryId) {
  const clients = new Map();
  Object.values(states || {}).forEach(function (state) {
    const attrs = state.attributes || {};
    const metric = attrs.tenda_mw6_metric;
    if (attrs.tenda_mw6_client !== true || !attrs.client_mac) return;
    if (metric !== "online" && metric !== "signal") return;
    if (entryId && attrs.config_entry_id !== entryId) return;

    // Two meshes may in theory list the same MAC: key on entry + MAC.
    const key = String(attrs.config_entry_id || "") + ":" + attrs.client_mac;
    if (!clients.has(key)) {
      clients.set(key, {
        mac: attrs.client_mac,
        name: attrs.client_name || attrs.client_ip || attrs.client_mac,
        ip: attrs.client_ip || "",
        nodeSn: "",
        online: null,
        signal: null,
        wired: false,
        entityId: null,
      });
    }
    const client = clients.get(key);
    if (attrs.node_sn) client.nodeSn = attrs.node_sn;
    if (metric === "signal") {
      client.signal = mw6tAvailable(state) ? mw6tNumber(state.state) : null;
    } else {
      client.entityId = state.entity_id;
      client.online = mw6tAvailable(state) ? state.state === "on" : null;
    }
  });
  return Array.from(clients.values()).map(function (client) {
    client.wired = client.online === true && client.signal === null;
    return client;
  });
}

/**
 * Apply the view filters to one client.
 * @param {object} client Client from mw6tCollectClients.
 * @param {{showOffline: boolean, weakOnly: boolean, weakThreshold: number}} options
 * @returns {boolean} True when the client must be displayed.
 */
function mw6tKeepClient(client, options) {
  if (!options.showOffline && client.online !== true) return false;
  if (options.weakOnly) return client.signal !== null && client.signal <= options.weakThreshold;
  return true;
}

/**
 * Client order: online first, then strongest signal, then wired / no signal, then name.
 * @returns {number}
 */
function mw6tCompareClients(left, right) {
  const leftOnline = left.online === true;
  const rightOnline = right.online === true;
  if (leftOnline !== rightOnline) return leftOnline ? -1 : 1;
  if (left.signal !== null && right.signal !== null && left.signal !== right.signal) {
    return right.signal - left.signal;
  }
  if ((left.signal === null) !== (right.signal === null)) return left.signal === null ? 1 : -1;
  return mw6tCompareText(left.name, right.name);
}

/**
 * Node order: nodes with an area first, sorted by area, then by name.
 * @returns {number}
 */
function mw6tCompareNodes(left, right) {
  if (left.area !== right.area) {
    if (!left.area) return 1;
    if (!right.area) return -1;
    return mw6tCompareText(left.area, right.area);
  }
  return mw6tCompareText(left.name, right.name);
}

/**
 * Build the topology shown by the card.
 *
 * `online` and `total` of a node count all its clients, whatever the filters; `clients`
 * holds only the filtered, sorted ones. Clients whose node has no sensor (unknown or
 * empty node_sn) go to `orphans`, with the same filters.
 *
 * @example
 *   const topo = mw6tBuildTopology(hass.states, hass.entities, hass.devices, hass.areas,
 *     { weakOnly: true, weakThreshold: -70 });
 *   topo.nodes[0]; // { sn, name: "Borne salon", area: "Salon", online: 6, total: 6, clients: [...] }
 *
 * @param {object} states hass.states.
 * @param {object} entities hass.entities.
 * @param {object} devices hass.devices.
 * @param {object} areas hass.areas.
 * @param {{showOffline?: boolean, weakOnly?: boolean, weakThreshold?: number, entryId?: string|null}} options
 * @returns {{nodes: object[], orphans: object[]}}
 */
function mw6tBuildTopology(states, entities, devices, areas, options) {
  const opts = Object.assign(
    { showOffline: false, weakOnly: false, weakThreshold: MW6T_DEFAULT_WEAK, entryId: null },
    options || {}
  );
  const nodes = mw6tCollectNodes(states, entities, devices, areas, opts.entryId);
  const orphans = [];
  mw6tCollectClients(states, opts.entryId).forEach(function (client) {
    const node = nodes.get(client.nodeSn);
    (node ? node.clients : orphans).push(client);
  });

  const list = Array.from(nodes.values()).map(function (node) {
    return Object.assign({}, node, {
      online: node.clients.filter(function (client) { return client.online === true; }).length,
      total: node.clients.length,
      clients: node.clients
        .filter(function (client) { return mw6tKeepClient(client, opts); })
        .sort(mw6tCompareClients),
    });
  }).sort(mw6tCompareNodes);

  return {
    nodes: list,
    orphans: orphans
      .filter(function (client) { return mw6tKeepClient(client, opts); })
      .sort(mw6tCompareClients),
  };
}

/**
 * Signal quality class of a client, used to colour its dot.
 * @param {{signal: number|null, wired?: boolean}} client
 * @param {number} weakThreshold dBm; a signal at or below it is "weak".
 * @returns {"wired"|"unknown"|"good"|"medium"|"weak"}
 */
function mw6tSignalLevel(client, weakThreshold) {
  if (client.wired) return "wired";
  if (client.signal === null || client.signal === undefined) return "unknown";
  if (client.signal <= weakThreshold) return "weak";
  if (client.signal >= MW6T_GOOD_SIGNAL) return "good";
  return "medium";
}

// Export the pure model to Node tests; in the browser `module` does not exist.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MW6T_DEFAULT_WEAK: MW6T_DEFAULT_WEAK,
    mw6tBuildTopology: mw6tBuildTopology,
    mw6tEscape: mw6tEscape,
    mw6tNumber: mw6tNumber,
    mw6tSignalLevel: mw6tSignalLevel,
  };
}
