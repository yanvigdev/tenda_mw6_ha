from __future__ import annotations

from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import (
    TendaMW6Api,
    TendaMW6Client,
    TendaMW6Error,
    TendaMW6InventorySummary,
    TendaMW6NodeSummary,
    TendaMW6Qos,
    TendaMW6TransferReadiness,
    summarize_inventory,
    summarize_nodes,
    summarize_transfer_readiness,
)


# Poll period of the MW6 HostList. 60 s keeps the Home Assistant recorder
# reasonable: every poll rewrites ~500 entities (12 sensors + 1 binary sensor
# per Wi-Fi client), and at the former 10 s period this meant ~8,600 state rows
# per entity and per day.
UPDATE_INTERVAL = timedelta(seconds=60)

# Largest gap between two rate samples that the transfer counters still
# integrate. Three poll periods tolerate one or two missed polls without
# turning a long outage into an invented transfer span (rate x gap).
#
# Example: with a 60 s period, samples 60 s or 120 s apart are integrated,
# a 200 s gap (after a router reboot) is skipped.
MAX_TRANSFER_SAMPLE_GAP_SECONDS = 3 * UPDATE_INTERVAL.total_seconds()


class TendaMW6Coordinator(DataUpdateCoordinator[list[TendaMW6Client]]):
    """Poll the MW6 local TCP/9000 API."""

    def __init__(
        self,
        hass: HomeAssistant,
        api: TendaMW6Api,
        device_aliases: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            hass,
            logger=__import__("logging").getLogger(__name__),
            name="Tenda MW6 clients",
            update_interval=UPDATE_INTERVAL,
        )
        self.api = api
        self.device_aliases = device_aliases or {}
        # Global QoS caps, refreshed on a best-effort basis on every poll.
        self.qos: TendaMW6Qos | None = None

    async def _async_update_data(self) -> list[TendaMW6Client]:
        try:
            clients = await self.hass.async_add_executor_job(self.api.get_clients)
        except (OSError, TendaMW6Error) as exc:
            raise UpdateFailed(f"Unable to read Tenda MW6 clients: {exc}") from exc

        # QoS is secondary data: a failure to read it must NEVER fail the client
        # poll (robustness = "no risk").
        try:
            self.qos = await self.hass.async_add_executor_job(self.api.get_qos)
        except (OSError, TendaMW6Error) as exc:
            self.logger.debug("QoS read unavailable: %s", exc)

        return clients

    def client_display_name(self, client: TendaMW6Client) -> str:
        """Return a configured alias or the best name reported by the MW6."""
        ip_key = client.ip.strip().lower()
        mac_key = client.mac.strip().lower().replace("-", ":")

        for key in (ip_key, mac_key):
            if key in self.device_aliases:
                # A deliberately empty alias means "show the current IP".
                return self.device_aliases[key] or ip_key or mac_key

        return client.name.strip() or ip_key or mac_key

    @property
    def inventory_summary(self) -> TendaMW6InventorySummary:
        """Return the current HostList online-state summary."""
        return summarize_inventory(self.data or [])

    @property
    def node_summaries(self) -> dict[str, TendaMW6NodeSummary]:
        """Return the per-node summary of the last HostList, keyed by node serial."""
        return summarize_nodes(self.data or [])

    @property
    def transfer_readiness(self) -> TendaMW6TransferReadiness:
        """Return whether the current HostList can drive local transfer counters."""
        return summarize_transfer_readiness(self.data or [])
