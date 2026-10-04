"""Tests of the node device identifier helpers (no Home Assistant dependency)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
import unittest


MODULE_PATH = (
    Path(__file__).parents[1] / "custom_components" / "tenda_mw6" / "node_identity.py"
)
SPEC = importlib.util.spec_from_file_location("tenda_mw6_node_identity_test", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
NODE_IDENTITY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = NODE_IDENTITY
SPEC.loader.exec_module(NODE_IDENTITY)


class NodeIdentityTest(unittest.TestCase):
    def test_identifier_round_trip_keeps_serial_case(self) -> None:
        identifier = NODE_IDENTITY.node_device_identifier("entry1", "E00000000000000001")
        self.assertEqual(identifier, "entry1:node:E00000000000000001")
        self.assertEqual(
            NODE_IDENTITY.node_sn_from_device_identifier("entry1", identifier),
            "E00000000000000001",
        )

    def test_client_and_hub_identifiers_are_not_nodes(self) -> None:
        self.assertIsNone(
            NODE_IDENTITY.node_sn_from_device_identifier("entry1", "entry1:02:00:00:00:00:01")
        )
        self.assertIsNone(NODE_IDENTITY.node_sn_from_device_identifier("entry1", "entry1"))

    def test_other_entry_identifier_is_ignored(self) -> None:
        self.assertIsNone(
            NODE_IDENTITY.node_sn_from_device_identifier("entry1", "entry2:node:SN1")
        )

    def test_empty_serial_is_ignored(self) -> None:
        self.assertIsNone(
            NODE_IDENTITY.node_sn_from_device_identifier("entry1", "entry1:node:")
        )


if __name__ == "__main__":
    unittest.main()
