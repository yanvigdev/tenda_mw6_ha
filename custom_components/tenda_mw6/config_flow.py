from __future__ import annotations

import ipaddress
import socket
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from . import (
    CONF_DEVICE_ALIASES,
    CONF_SERIAL,
    DOMAIN,
    parse_device_aliases,
)
from .api import SERIAL_RE, TendaMW6Api, TendaMW6AuthError, TendaMW6Error


async def _validate_input(hass: HomeAssistant, data: dict) -> None:
    """Validate the serial number format then test the real connection.

    Raises ``ValueError`` if the serial number is malformed, or a
    ``TendaMW6*``/network exception if the router is unreachable or rejects
    authentication.
    """
    serial = str(data[CONF_SERIAL]).strip()
    if not SERIAL_RE.fullmatch(serial):
        raise ValueError("invalid_serial")

    api = TendaMW6Api(
        host=str(data[CONF_HOST]),
        port=int(data[CONF_PORT]),
        serial=serial,
    )
    await hass.async_add_executor_job(api.validate)


class TendaMW6ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Tenda MW6."""

    VERSION = 3

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> config_entries.OptionsFlow:
        """Return the flow used to edit device aliases."""
        return TendaMW6OptionsFlow()

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                await _validate_input(self.hass, user_input)
            except TendaMW6AuthError:
                errors["base"] = "invalid_auth"
            except (TendaMW6Error, socket.timeout, OSError):
                errors["base"] = "cannot_connect"
            except ValueError:
                errors["base"] = "invalid_serial"
            else:
                host = str(user_input[CONF_HOST]).strip()
                serial = str(user_input[CONF_SERIAL]).strip()
                await self.async_set_unique_id(host)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"Tenda MW6 ({host})",
                    data={
                        CONF_HOST: host,
                        CONF_PORT: int(user_input[CONF_PORT]),
                        CONF_SERIAL: serial,
                    },
                )

        schema = vol.Schema(
            {
                # IP of the master node (the one exposing TCP port 9000).
                vol.Required(CONF_HOST, default="192.168.0.1"): str,
                vol.Required(CONF_PORT, default=9000): vol.Coerce(int),
                # Serial number of a node (under the unit / in its QR code).
                vol.Required(CONF_SERIAL): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)


def _client_sort_key(client: Any) -> tuple[int, int, int, str]:
    """Sort clients by IP, with malformed or missing addresses last."""
    try:
        address = ipaddress.ip_address(client.ip.strip())
        return (0, address.version, int(address), client.mac.lower())
    except ValueError:
        return (1, 0, 0, f"{client.ip}|{client.mac}".lower())


def _render_current_device_map(
    hass: HomeAssistant,
    entry: ConfigEntry,
    saved_raw: str,
) -> str:
    """Render every currently known client as IP | MAC = name."""
    try:
        saved_aliases = parse_device_aliases(saved_raw)
    except ValueError:
        return saved_raw

    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    clients = list(coordinator.data or []) if coordinator is not None else []
    if not clients:
        return saved_raw

    lines = [
        "# IP | MAC = name",
        "# An empty name after the = sign forces the IP to be displayed.",
    ]
    used_keys: set[str] = set()

    for client in sorted(clients, key=_client_sort_key):
        ip = client.ip.strip()
        mac = client.mac.strip().lower().replace("-", ":")
        keys = [key for key in (ip, mac) if key]

        alias_was_saved = False
        alias = ""
        for key in keys:
            if key in saved_aliases:
                alias = saved_aliases[key]
                alias_was_saved = True
                break

        if not alias_was_saved:
            alias = client.name.strip()

        for key in keys:
            if key in saved_aliases:
                used_keys.add(key)

        selectors = " | ".join(keys)
        if selectors:
            lines.append(f"{selectors} = {alias}")

    for key, alias in saved_aliases.items():
        if key not in used_keys:
            lines.append(f"{key} = {alias}")

    return "\n".join(lines)


class TendaMW6OptionsFlow(config_entries.OptionsFlow):
    """Manage user-defined names for known clients."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Edit the live IP/MAC/name map."""
        errors: dict[str, str] = {}
        submitted_raw: str | None = None

        if user_input is not None:
            submitted_raw = str(user_input.get(CONF_DEVICE_ALIASES, ""))
            try:
                parse_device_aliases(submitted_raw)
            except ValueError:
                errors["base"] = "invalid_aliases"
            else:
                return self.async_create_entry(
                    title="",
                    data={CONF_DEVICE_ALIASES: submitted_raw},
                )

        entry = self.hass.config_entries.async_get_entry(self.handler)
        saved_raw = (
            str(entry.options.get(CONF_DEVICE_ALIASES, "")) if entry is not None else ""
        )
        current_map = (
            submitted_raw
            if submitted_raw is not None
            else (
                _render_current_device_map(self.hass, entry, saved_raw)
                if entry is not None
                else saved_raw
            )
        )
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_DEVICE_ALIASES,
                    default=current_map,
                ): selector.TextSelector(
                    selector.TextSelectorConfig(multiline=True)
                )
            }
        )
        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
        )
