/**
 * Tests of the topology card: pure model first (this file), rendering added in Phase 10.
 * Run with: node tests/test_topology_card.js
 */
const assert = require("node:assert/strict");

const registry = new Map();
global.HTMLElement = class {};
global.customElements = {
  define(name, klass) { registry.set(name, klass); },
  get(name) { return registry.get(name); },
};
global.window = global;
global.window.customCards = [];

const model = require("../custom_components/tenda_mw6/tenda-mw6-topology-card.js");

/** Build the two client states (online + signal) the card reads for one client. */
function clientStates(key, mac, name, ip, nodeSn, online, signal, entry) {
  const base = {
    tenda_mw6_client: true,
    config_entry_id: entry || "entry",
    client_mac: mac,
    client_ip: ip,
    client_name: name,
    node_sn: nodeSn,
  };
  return {
    ["binary_sensor." + key + "_online"]: {
      entity_id: "binary_sensor." + key + "_online",
      state: online ? "on" : "off",
      attributes: Object.assign({ tenda_mw6_metric: "online" }, base),
    },
    ["sensor." + key + "_signal"]: {
      entity_id: "sensor." + key + "_signal",
      state: signal === null ? "unknown" : String(signal),
      attributes: Object.assign({ tenda_mw6_metric: "signal" }, base),
    },
  };
}

/** Build one node sensor state. */
function nodeState(key, sn, metric, entry) {
  const id = "sensor." + key + "_" + metric;
  return {
    [id]: {
      entity_id: id,
      state: "0",
      attributes: {
        tenda_mw6_node: true,
        tenda_mw6_metric: metric,
        node_sn: sn,
        config_entry_id: entry || "entry",
      },
    },
  };
}

const states = Object.assign(
  {},
  nodeState("salon", "SN0001", "node_online"),
  nodeState("salon", "SN0001", "node_wifi"),
  nodeState("cave", "SN0004", "node_online"),
  clientStates("phone", "02:00:00:00:00:01", "Phone", "192.0.2.10", "SN0001", true, -45),
  clientStates("relay", "02:00:00:00:00:02", "Relay", "192.0.2.11", "SN0001", true, -75),
  clientStates("nas", "02:00:00:00:00:03", "NAS", "192.0.2.12", "SN0001", true, null),
  clientStates("old", "02:00:00:00:00:04", "Old", "192.0.2.13", "SN0004", false, null),
  clientStates("lost", "02:00:00:00:00:05", "Lost", "192.0.2.14", "SN9999", true, -50),
  clientStates("other", "02:00:00:00:00:06", "Other", "192.0.2.15", "SN0001", true, -40, "entry2"),
);
const entities = {
  "sensor.salon_node_online": { entity_id: "sensor.salon_node_online", device_id: "dev1" },
  "sensor.salon_node_wifi": { entity_id: "sensor.salon_node_wifi", device_id: "dev1" },
  // The cave node has no registry entry: the card must fall back to the serial.
};
const devices = { dev1: { id: "dev1", name: "Tenda MW6 node …0001", name_by_user: "Living room node", area_id: "salon" } };
const areas = { salon: { area_id: "salon", name: "Salon" } };

function names(list) { return list.map((item) => item.name); }

// Default view, filtered on the first mesh: nodes sorted by area then name; online clients only.
let topo = model.mw6tBuildTopology(states, entities, devices, areas, { entryId: "entry" });
assert.deepEqual(names(topo.nodes), ["Living room node", "…0004"]);
assert.equal(topo.nodes[0].area, "Salon");
assert.equal(topo.nodes[0].entityId, "sensor.salon_node_online");
assert.equal(topo.nodes[0].deviceId, "dev1");
assert.deepEqual(names(topo.nodes[0].clients), ["Phone", "Relay", "NAS"]);
assert.equal(topo.nodes[0].online, 3);
assert.equal(topo.nodes[0].total, 3);
assert.equal(topo.nodes[0].clients[2].wired, true);
// A node without any online client stays visible with 0/N.
assert.deepEqual(topo.nodes[1].clients, []);
assert.equal(topo.nodes[1].online, 0);
assert.equal(topo.nodes[1].total, 1);
// An online client on a node without sensors yet is never hidden.
assert.deepEqual(names(topo.orphans), ["Lost"]);

// Offline clients shown on demand.
topo = model.mw6tBuildTopology(states, entities, devices, areas, { entryId: "entry", showOffline: true });
assert.deepEqual(names(topo.nodes[1].clients), ["Old"]);
assert.equal(topo.nodes[1].clients[0].wired, false);

// Weak-signal filter keeps Wi-Fi clients at or below the threshold only.
topo = model.mw6tBuildTopology(states, entities, devices, areas, { entryId: "entry", weakOnly: true });
assert.deepEqual(names(topo.nodes[0].clients), ["Relay"]);
assert.deepEqual(topo.orphans, []);
topo = model.mw6tBuildTopology(states, entities, devices, areas, { entryId: "entry", weakOnly: true, weakThreshold: -80 });
assert.deepEqual(topo.nodes[0].clients, []);

// Without entryId, both meshes are merged; with another entryId, nothing of the first one leaks.
topo = model.mw6tBuildTopology(states, entities, devices, areas, {});
assert.deepEqual(names(topo.nodes[0].clients), ["Other", "Phone", "Relay", "NAS"]);
topo = model.mw6tBuildTopology(states, entities, devices, areas, { entryId: "entry2" });
assert.deepEqual(topo.nodes, []);
// The second mesh has no node sensor here: its online client is an orphan, not lost.
assert.deepEqual(names(topo.orphans), ["Other"]);

// Missing hass collections never throw.
topo = model.mw6tBuildTopology(undefined, undefined, undefined, undefined, undefined);
assert.deepEqual(topo, { nodes: [], orphans: [] });

// Signal levels.
assert.equal(model.mw6tSignalLevel({ online: true, signal: null, wired: true }, -70), "wired");
assert.equal(model.mw6tSignalLevel({ online: false, signal: null, wired: false }, -70), "unknown");
assert.equal(model.mw6tSignalLevel({ signal: -60 }, -70), "good");
assert.equal(model.mw6tSignalLevel({ signal: -65 }, -70), "medium");
assert.equal(model.mw6tSignalLevel({ signal: -70 }, -70), "weak");

// Escaping.
assert.equal(model.mw6tEscape("<a href='x'>&\""), "&lt;a href=&#039;x&#039;&gt;&amp;&quot;");

// ---- Rendering (Phase 10) ----
const Card = registry.get("tenda-mw6-topology-card");
assert.ok(Card, "custom element registered");
assert.ok(window.customCards.some((card) => card.type === "tenda-mw6-topology-card"));
assert.deepEqual(Card.getStubConfig(), {});

/** Card instance without constructor (no shadow DOM in Node), as in test_card.js. */
function makeCard(config, hass, settings) {
  const card = Object.create(Card.prototype);
  card._config = config || {};
  card._hass = hass;
  card._settings = Object.assign({ showOffline: false, weakOnly: false }, settings || {});
  return card;
}

const hass = { language: "fr", states, entities, devices, areas };
let html = makeCard({ entry_id: "entry" }, hass)._html();
assert.match(html, /Topologie du mesh Wi-Fi/);
assert.match(html, /Living room node/);
assert.match(html, /Salon/);
assert.match(html, /3\/3 en ligne/);
assert.match(html, /Sans borne/);
assert.match(html, /data-entity="sensor\.salon_node_online"/);
assert.match(html, /data-entity="binary_sensor\.phone_online"/);
assert.match(html, /class="dot weak"/);
assert.match(html, /mdi:ethernet/);
assert.match(html, /-45 dBm/);

// Custom title and settings reflected in the toggles.
html = makeCard({ entry_id: "entry", title: "Maison" }, hass, { weakOnly: true })._html();
assert.match(html, /Maison/);
assert.match(html, /data-setting="weakOnly" checked/);
assert.doesNotMatch(html, /Phone/);

// A hostile DHCP name is rendered as text, never as markup.
const hostile = Object.assign({}, states, clientStates(
  "evil", "02:00:00:00:00:09", "<img src=x onerror=alert(1)>", "192.0.2.99", "SN0001", true, -50
));
html = makeCard({ entry_id: "entry" }, Object.assign({}, hass, { states: hostile }))._html();
assert.doesNotMatch(html, /<img src=x/);
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);

// Invalid threshold falls back to the default; a valid one is used as-is.
assert.equal(makeCard({ weak_signal_threshold: "abc" }, hass)._weakThreshold(), -70);
assert.equal(makeCard({ weak_signal_threshold: -65 }, hass)._weakThreshold(), -65);

// Empty state message.
html = makeCard({}, { language: "en", states: {} })._html();
assert.match(html, /No Tenda MW6 node found/);

// Localization with English fallback.
assert.equal(makeCard({}, { language: "pl-PL" })._t("orphans"), "Bez węzła");
assert.equal(makeCard({}, { language: "de" })._t("orphans"), "No node");
assert.equal(makeCard({}, null)._lang(), "en");

console.log("Tenda MW6 topology card tests passed");
