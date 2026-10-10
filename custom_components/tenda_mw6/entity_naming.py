"""Entity naming and lifecycle rules shared by the platforms.

Kept free of Home Assistant imports so it can be unit tested without HA. Three
conventions live here:

- the object id suggested for a client entity, prefixed ``tenda_mw6_`` so it
  never collides with an entity of another integration named after the same
  device (``mobile_app`` also creates ``sensor.<phone>_connection_type``);
- which unique ids belong to the rate and transfer sensors, created disabled by
  default and disabled on upgrade because a bridged mesh reports no rate;
- which devices the user may remove from the device registry: only those absent
  from the last HostList.

Example:
    >>> client_object_id("Living room TV", "aa:bb:cc:dd:ee:ff", "signal")
    'tenda_mw6_living_room_tv_signal'
    >>> is_rate_or_transfer_unique_id("entry1_aa:bb:cc:dd:ee:ff_download_rate")
    True
    >>> is_device_removable("entry1", "entry1:aa:bb:cc:dd:ee:ff", set(), set())
    True
"""

from __future__ import annotations

import re
import unicodedata

from .node_identity import node_sn_from_device_identifier

ENTITY_ID_PREFIX = "tenda_mw6"

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_RATE_OR_TRANSFER_RE = re.compile(r"_(?:upload|download)_(?:rate|transfer_(?:total|day|month))$")


def _slug(text: str) -> str:
    """Lower-case ASCII slug: accents stripped, runs of other characters → ``_``.

    Example:
        >>> _slug("iPad d'Angélique")
        'ipad_d_angelique'
        >>> _slug("***")
        ''
    """
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return _NON_ALNUM_RE.sub("_", ascii_text.lower()).strip("_")


def client_object_id(display_name: str, mac: str, suffix: str) -> str:
    """Return the object id to suggest for one entity of a client device.

    Args:
        display_name: Name shown for the client (alias or DHCP name).
        mac: Client MAC address, any case; used when the name yields no slug.
        suffix: Metric suffix, identical to the one used in the unique id
            (``signal``, ``ip``, ``online``, ``download_rate``...).

    The suggestion is only honoured by Home Assistant when the entity is first
    registered: an entity already in the registry keeps its current id.

    Example:
        >>> client_object_id("sonoff-8", "c8:2b:96:51:31:cb", "signal")
        'tenda_mw6_sonoff_8_signal'
        >>> client_object_id("", "C8:2B:96:51:31:CB", "online")
        'tenda_mw6_c82b965131cb_online'
    """
    slug = _slug(display_name) or _slug(mac.replace(":", "").replace("-", ""))
    return f"{ENTITY_ID_PREFIX}_{slug}_{suffix}"


def is_rate_or_transfer_unique_id(unique_id: str) -> bool:
    """Tell whether a unique id belongs to a rate or transfer sensor.

    Matches the client sensors (``<entry>_<mac>_<direction>_rate`` and
    ``..._<direction>_transfer_<period>``) and the aggregate ones
    (``<entry>_aggregate_<direction>_...``); health, QoS and node sensors do not match.

    Example:
        >>> is_rate_or_transfer_unique_id("e_aggregate_upload_transfer_month")
        True
        >>> is_rate_or_transfer_unique_id("e_transfer_counting_health")
        False
    """
    return _RATE_OR_TRANSFER_RE.search(unique_id) is not None


def is_device_removable(
    entry_id: str,
    identifier: str,
    current_macs: set[str],
    current_node_serials: set[str],
) -> bool:
    """Tell whether one device identifier may be removed by the user.

    Args:
        entry_id: Config entry owning the device.
        identifier: Second item of the ``(DOMAIN, identifier)`` device identifier.
        current_macs: MAC addresses present in the last HostList, any case.
        current_node_serials: Node serials present in the last HostList.

    Returns:
        False for the hub, for a client or node still present, and for an
        identifier of another config entry; True for a client or node that the
        mesh no longer reports.

    Example:
        >>> is_device_removable("e1", "e1:node:SN1", set(), {"SN1"})
        False
        >>> is_device_removable("e1", "e1:node:SN1", set(), set())
        True
    """
    if identifier == entry_id:
        return False
    node_sn = node_sn_from_device_identifier(entry_id, identifier)
    if node_sn is not None:
        return node_sn not in current_node_serials
    prefix = f"{entry_id}:"
    if not identifier.startswith(prefix):
        return False
    mac = identifier[len(prefix):].lower()
    return mac not in {value.lower() for value in current_macs}
