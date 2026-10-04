"""Device registry identifiers of mesh node devices.

Kept free of Home Assistant imports so it can be unit tested without HA. The node
serial is stored with its original case in the device identifier; it is the only
place it can be recovered from after a restart (entity unique ids are lower-cased).

Example:
    >>> node_device_identifier("entry1", "E00000000000000001")
    'entry1:node:E00000000000000001'
    >>> node_sn_from_device_identifier("entry1", "entry1:node:E00000000000000001")
    'E00000000000000001'
    >>> node_sn_from_device_identifier("entry1", "entry1:02:00:00:00:00:01") is None
    True
"""

from __future__ import annotations

_NODE_MARKER = ":node:"


def node_device_identifier(entry_id: str, node_sn: str) -> str:
    """Return the device identifier (second item of the HA identifier tuple) of a node.

    Args:
        entry_id: Config entry owning the node device.
        node_sn: Node serial number, as reported by the mesh.
    """
    return f"{entry_id}{_NODE_MARKER}{node_sn}"


def node_sn_from_device_identifier(entry_id: str, identifier: str) -> str | None:
    """Extract the node serial from a device identifier of this config entry.

    Args:
        entry_id: Config entry whose node devices are wanted.
        identifier: Second item of a ``(DOMAIN, identifier)`` device identifier.

    Returns:
        The serial number, or None for hub/client identifiers, identifiers of
        another config entry, and an empty serial.
    """
    prefix = f"{entry_id}{_NODE_MARKER}"
    if not identifier.startswith(prefix):
        return None
    return identifier[len(prefix):] or None
