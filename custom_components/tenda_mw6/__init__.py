from __future__ import annotations

import ipaddress
from pathlib import Path
import re

from homeassistant.components.frontend import add_extra_js_url
try:
    from homeassistant.components.http import StaticPathConfig
except ImportError:  # Home Assistant < 2024.7
    StaticPathConfig = None  # type: ignore[misc, assignment]
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .api import TendaMW6Api
from .coordinator import TendaMW6Coordinator
from .entity_naming import is_device_removable, is_rate_or_transfer_unique_id

DOMAIN = "tenda_mw6"
PLATFORMS: tuple[Platform, ...] = (
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.SELECT,
)
# Configuration key: a node serial number, used for local authentication
# (qrmsg field of the LoginMsg). Replaces the former 32-hex "account".
CONF_SERIAL = "serial"
CONF_DEVICE_ALIASES = "device_aliases"
# Lovelace cards bundled with the integration, served from this package directory
# under /tenda_mw6/<file name>.
FRONTEND_FILES: tuple[str, ...] = (
    "tenda-mw6-card.js",
    "tenda-mw6-topology-card.js",
)

_MAC_RE = re.compile(r"^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$", re.IGNORECASE)


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve and load the bundled Lovelace cards exactly once.

    Each file is exposed as a static path and announced with add_extra_js_url. On some
    installations this is not enough to load a card; a Lovelace resource must then be
    declared by the user (see README).
    """
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("frontend_registered"):
        return

    paths = [
        (f"/{DOMAIN}/{file_name}", str(Path(__file__).with_name(file_name)))
        for file_name in FRONTEND_FILES
    ]
    if StaticPathConfig is not None and hasattr(
        hass.http, "async_register_static_paths"
    ):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(url, path, False) for url, path in paths]
        )
    else:
        for url, path in paths:
            hass.http.register_static_path(url, path, False)

    for url, _ in paths:
        add_extra_js_url(hass, url)
    domain_data["frontend_registered"] = True


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register frontend assets independently of router availability."""
    await _async_register_frontend(hass)
    return True


def _normalize_device_selector(selector: str, line_number: int) -> str:
    """Normalize one exact IP or MAC selector."""
    try:
        return str(ipaddress.ip_address(selector))
    except ValueError:
        normalized = selector.lower().replace("-", ":")
        if not _MAC_RE.fullmatch(normalized):
            raise ValueError(f"Invalid IP or MAC on line {line_number}") from None
        return normalized


def parse_device_aliases(raw: str) -> dict[str, str]:
    """Parse newline-separated IP | MAC = alias entries.

    An empty alias is intentional and forces the client IP to be displayed.
    """
    aliases: dict[str, str] = {}
    for line_number, raw_line in enumerate(raw.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        selectors_raw, separator, alias = line.partition("=")
        selectors = [
            selector.strip()
            for selector in selectors_raw.split("|")
            if selector.strip()
        ]
        if not separator or not selectors:
            raise ValueError(f"Invalid alias mapping on line {line_number}")

        alias = alias.strip()
        for selector in selectors:
            aliases[_normalize_device_selector(selector, line_number)] = alias

    return aliases


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate config entries to the "serial number" schema.

    Older schemas (v1: raw LoginMsg payload; v2: 32-hex "account") cannot be
    converted automatically to a serial number: the value cannot be derived.
    Migration is therefore refused to force a simple reconfiguration by the user
    (entering the serial number, no capture needed).

    Entries on v3 are accepted; minor version 1 → 2 disables the rate and
    transfer entities that are still enabled (they are created disabled since
    2.2.0 because a bridged mesh reports no rate). Entities the user disabled
    themselves are left untouched, and the user may re-enable any of them.
    """
    if entry.version < 3:
        # v1/v2: no conversion possible -> the user re-creates the integration.
        return False
    if entry.minor_version < 2:
        _disable_rate_and_transfer_entities(hass, entry)
        hass.config_entries.async_update_entry(entry, minor_version=2)
    return True


def _disable_rate_and_transfer_entities(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Disable (by the integration) every enabled rate/transfer entity of the entry."""
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.disabled_by is None and is_rate_or_transfer_unique_id(entity.unique_id):
            registry.async_update_entity(
                entity.entity_id, disabled_by=er.RegistryEntryDisabler.INTEGRATION
            )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Tenda MW6 from a config entry."""
    await _async_register_frontend(hass)
    api = TendaMW6Api(
        host=entry.data["host"],
        port=int(entry.data.get("port", 9000)),
        serial=str(entry.data[CONF_SERIAL]),
    )
    aliases = parse_device_aliases(str(entry.options.get(CONF_DEVICE_ALIASES, "")))
    coordinator = TendaMW6Coordinator(hass, api, device_aliases=aliases)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry after its alias options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: ConfigEntry, device_entry: dr.DeviceEntry
) -> bool:
    """Allow the user to delete a client or node device the mesh no longer reports.

    The HostList keeps every client ever seen only while the mesh does; once a
    device (a phone that left, a replaced board, a node seen as a client during
    setup) disappears from the poll, its entities stay unavailable forever
    unless the user removes the device from the UI, which calls this hook.
    The hub and any client or node present in the last poll are refused.
    """
    coordinator: TendaMW6Coordinator = hass.data[DOMAIN][entry.entry_id]
    current_macs = {client.mac.lower() for client in coordinator.data or []}
    current_nodes = set(coordinator.node_summaries)
    return all(
        is_device_removable(entry.entry_id, identifier, current_macs, current_nodes)
        for domain, identifier in device_entry.identifiers
        if domain == DOMAIN
    )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Tenda MW6 config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return unloaded
