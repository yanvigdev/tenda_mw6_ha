/**
 * Tenda MW6 Topology Card
 *
 * A dependency-free Lovelace card bundled with the Tenda MW6 integration. It shows one
 * column per mesh node, with the clients each node carries and their signal quality.
 * Nodes are Home Assistant devices: their name and area come from the device registry,
 * so renaming a node or assigning it an area in HA is reflected here.
 *
 * Every top-level identifier is prefixed with mw6t / MW6T_. Home Assistant loads both
 * card files as ES modules (no shared scope), but the prefix keeps them distinct if a
 * file is ever loaded as a classic script, and makes this card's helpers easy to spot.
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

/** Visible labels per language; the card follows hass.language and falls back to English. */
const MW6T_I18N = {
  en: {
    title: "Mesh Wi-Fi topology",
    showOffline: "Offline",
    weakOnly: "Weak signal only",
    online: "online",
    orphans: "No node",
    empty: "No device",
    noNodes: "No Tenda MW6 node found. Restart Home Assistant after updating the integration.",
  },
  fr: {
    title: "Topologie du mesh Wi-Fi",
    showOffline: "Hors ligne",
    weakOnly: "Signal faible seulement",
    online: "en ligne",
    orphans: "Sans borne",
    empty: "Aucun appareil",
    noNodes: "Aucune borne trouvée. Redémarrez Home Assistant après la mise à jour de l'intégration.",
  },
  pl: {
    title: "Topologia sieci mesh",
    showOffline: "Offline",
    weakOnly: "Tylko słaby sygnał",
    online: "online",
    orphans: "Bez węzła",
    empty: "Brak urządzeń",
    noNodes: "Nie znaleziono węzłów Tenda MW6. Uruchom ponownie Home Assistant po aktualizacji integracji.",
  },
};

/** localStorage key of the per-browser toggle state. */
const MW6T_STORAGE_KEY = "tenda-mw6-topology-card:settings";

/**
 * Read the toggle state saved in this browser.
 * Storage may be blocked (private mode, previews): defaults are returned then.
 * @returns {{showOffline: boolean, weakOnly: boolean}}
 */
function mw6tLoadSettings() {
  const settings = { showOffline: false, weakOnly: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MW6T_STORAGE_KEY) || "{}");
    settings.showOffline = parsed.showOffline === true;
    settings.weakOnly = parsed.weakOnly === true;
  } catch (_) {
    // Storage unavailable or corrupted: keep the defaults.
  }
  return settings;
}

/**
 * Save the toggle state in this browser; failures are ignored (the card still works).
 * @param {{showOffline: boolean, weakOnly: boolean}} settings
 */
function mw6tSaveSettings(settings) {
  try {
    window.localStorage.setItem(MW6T_STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {
    // Storage unavailable: the choice simply is not remembered.
  }
}

const MW6T_STYLES = [
  ":host { display:block; }",
  "ha-card { padding:16px; box-sizing:border-box; }",
  ".header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }",
  ".title { display:flex; align-items:center; gap:8px; font-size:1.1rem; font-weight:600; color:var(--primary-text-color); }",
  ".title ha-icon { color:var(--primary-color); }",
  ".toggles { display:flex; gap:14px; flex-wrap:wrap; font-size:.8rem; color:var(--secondary-text-color); }",
  ".toggles label { display:flex; align-items:center; gap:4px; cursor:pointer; }",
  ".grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }",
  ".column { min-width:0; padding:10px; border:1px solid var(--divider-color); border-radius:12px; }",
  ".node { margin-bottom:8px; }",
  ".node[data-entity] { cursor:pointer; }",
  ".node-name { font-weight:600; color:var(--primary-text-color); }",
  ".area, .count, .none, .empty { font-size:.75rem; color:var(--secondary-text-color); }",
  ".client { display:grid; grid-template-columns:10px minmax(0,1fr) auto; column-gap:8px; align-items:center; padding:4px 0; font-size:.85rem; color:var(--primary-text-color); }",
  ".client[data-entity] { cursor:pointer; }",
  ".client.offline { opacity:.5; }",
  ".client .dot { grid-row:1 / span 2; }",
  ".client .name { grid-column:2; grid-row:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
  ".client .ip { grid-column:2; grid-row:2; font-size:.7rem; color:var(--secondary-text-color); }",
  ".client .sig { grid-column:3; grid-row:1 / span 2; font-size:.75rem; color:var(--secondary-text-color); }",
  ".client ha-icon { --mdc-icon-size:16px; }",
  ".dot { width:10px; height:10px; border-radius:50%; background:var(--disabled-text-color,#9e9e9e); }",
  ".dot.good { background:var(--success-color,#2e7d32); }",
  ".dot.medium { background:var(--warning-color,#f9a825); }",
  ".dot.weak { background:var(--error-color,#c62828); }",
  ".dot.wired { background:var(--primary-color); }",
].join("\n");

/**
 * Lovelace custom element rendering the mesh topology.
 * Rendering is skipped when a hass update does not change the computed topology.
 */
class TendaMW6TopologyCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._signature = null;
    this._settings = mw6tLoadSettings();
    this.attachShadow({ mode: "open" });
  }

  /** Default configuration used by the card picker: everything is optional. */
  static getStubConfig() {
    return {};
  }

  /**
   * @param {{title?: string, entry_id?: string, weak_signal_threshold?: number}} config
   */
  setConfig(config) {
    this._config = Object.assign({}, config || {});
    this._signature = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Re-render only when what is displayed changes (names, areas, states, language).
    const signature = this._lang() + JSON.stringify(this._topology());
    if (signature === this._signature) return;
    this._signature = signature;
    this._render();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: "full", min_rows: 4 };
  }

  /** Two-letter language supported by the card, from hass.language; "en" otherwise. */
  _lang() {
    const language = String((this._hass && this._hass.language) || "en").toLowerCase().split("-")[0];
    return MW6T_I18N[language] ? language : "en";
  }

  /** Translated label, falling back to English then to the key itself. */
  _t(key) {
    return MW6T_I18N[this._lang()][key] || MW6T_I18N.en[key] || key;
  }

  /** Weak-signal threshold from the YAML, or the default when missing or not a number. */
  _weakThreshold() {
    const value = mw6tNumber(this._config.weak_signal_threshold);
    return value === null ? MW6T_DEFAULT_WEAK : value;
  }

  _topology() {
    const hass = this._hass || {};
    return mw6tBuildTopology(hass.states, hass.entities, hass.devices, hass.areas, {
      showOffline: this._settings.showOffline,
      weakOnly: this._settings.weakOnly,
      weakThreshold: this._weakThreshold(),
      entryId: this._config.entry_id || null,
    });
  }

  _togglesHtml() {
    return '<div class="toggles">' + ["showOffline", "weakOnly"].map(function (key) {
      return '<label><input type="checkbox" data-setting="' + key + '"' +
        (this._settings[key] ? " checked" : "") + "> " + mw6tEscape(this._t(key)) + "</label>";
    }, this).join("") + "</div>";
  }

  _clientHtml(client, threshold) {
    const level = mw6tSignalLevel(client, threshold);
    let value = "—";
    if (level === "wired") value = '<ha-icon icon="mdi:ethernet"></ha-icon>';
    else if (client.signal !== null) value = mw6tEscape(client.signal + " dBm");
    return '<div class="client' + (client.online === true ? "" : " offline") + '"' +
      (client.entityId ? ' data-entity="' + mw6tEscape(client.entityId) + '"' : "") + ">" +
      '<span class="dot ' + level + '"></span>' +
      '<span class="name">' + mw6tEscape(client.name) + "</span>" +
      '<span class="ip">' + mw6tEscape(client.ip) + "</span>" +
      '<span class="sig">' + value + "</span></div>";
  }

  /** One column: a node, or the "No node" group (no entityId, no area). */
  _columnHtml(column, threshold) {
    const head = '<div class="node"' +
      (column.entityId ? ' data-entity="' + mw6tEscape(column.entityId) + '"' : "") + ">" +
      '<div class="node-name">' + mw6tEscape(column.name) + "</div>" +
      (column.area ? '<div class="area">' + mw6tEscape(column.area) + "</div>" : "") +
      '<div class="count">' + column.online + "/" + column.total + " " + mw6tEscape(this._t("online")) + "</div></div>";
    const rows = column.clients.length
      ? column.clients.map(function (client) { return this._clientHtml(client, threshold); }, this).join("")
      : '<div class="none">' + mw6tEscape(this._t("empty")) + "</div>";
    return '<div class="column">' + head + rows + "</div>";
  }

  /** Full card markup; pure function of config, hass and settings (tested in Node). */
  _html() {
    const topology = this._topology();
    const threshold = this._weakThreshold();
    const columns = topology.nodes.map(function (node) { return this._columnHtml(node, threshold); }, this);
    if (topology.orphans.length) {
      columns.push(this._columnHtml({
        name: this._t("orphans"),
        area: "",
        entityId: null,
        online: topology.orphans.filter(function (client) { return client.online === true; }).length,
        total: topology.orphans.length,
        clients: topology.orphans,
      }, threshold));
    }
    const body = columns.length
      ? '<div class="grid">' + columns.join("") + "</div>"
      : '<div class="empty">' + mw6tEscape(this._t("noNodes")) + "</div>";
    return "<style>" + MW6T_STYLES + "</style><ha-card>" +
      '<div class="header"><div class="title"><ha-icon icon="mdi:access-point-network"></ha-icon>' +
      mw6tEscape(this._config.title || this._t("title")) + "</div>" + this._togglesHtml() + "</div>" +
      body + "</ha-card>";
  }

  /** Write the markup and bind the toggles and more-info clicks. */
  _render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = this._html();
    this.shadowRoot.querySelectorAll("input[data-setting]").forEach(function (input) {
      input.addEventListener("change", function () {
        this._settings[input.dataset.setting] = input.checked;
        mw6tSaveSettings(this._settings);
        this._signature = null;
        this._render();
      }.bind(this));
    }, this);
    this.shadowRoot.querySelectorAll("[data-entity]").forEach(function (element) {
      element.addEventListener("click", function () {
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          detail: { entityId: element.dataset.entity },
          bubbles: true,
          composed: true,
        }));
      }.bind(this));
    }, this);
  }
}

if (!customElements.get("tenda-mw6-topology-card")) {
  customElements.define("tenda-mw6-topology-card", TendaMW6TopologyCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(function (card) { return card.type === "tenda-mw6-topology-card"; })) {
  window.customCards.push({
    type: "tenda-mw6-topology-card",
    name: "Tenda MW6 Topology Card",
    description: "One column per mesh node with its clients and their signal (v" + MW6T_CARD_VERSION + ").",
    preview: true,
  });
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
