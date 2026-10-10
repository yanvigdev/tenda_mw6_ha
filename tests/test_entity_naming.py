"""Tests of the entity naming rules (no Home Assistant dependency)."""

from __future__ import annotations

import doctest
import importlib
import sys
import types
from pathlib import Path
import unittest


PACKAGE = Path(__file__).parents[1] / "custom_components" / "tenda_mw6"

# ``entity_naming`` imports ``node_identity`` relatively, so it must be loaded as a
# submodule of a package. A synthetic package pointing at the component folder
# avoids executing ``__init__.py`` (which needs Home Assistant) and keeps the
# folder off ``sys.path`` (its ``select.py`` would shadow the stdlib module).
_PACKAGE_NAME = "tenda_mw6_naming_test_pkg"
_package = types.ModuleType(_PACKAGE_NAME)
_package.__path__ = [str(PACKAGE)]
sys.modules[_PACKAGE_NAME] = _package
NAMING = importlib.import_module(f"{_PACKAGE_NAME}.entity_naming")


class ClientObjectIdTest(unittest.TestCase):
    def test_prefix_slug_and_suffix(self) -> None:
        self.assertEqual(
            NAMING.client_object_id("AngelePhone", "84:88:e1:28:20:01", "signal"),
            "tenda_mw6_angelephone_signal",
        )

    def test_special_characters_become_underscores(self) -> None:
        self.assertEqual(
            NAMING.client_object_id("iPad d'Angélique", "aa:bb:cc:dd:ee:ff", "ip"),
            "tenda_mw6_ipad_d_angelique_ip",
        )

    def test_empty_name_falls_back_to_mac(self) -> None:
        self.assertEqual(
            NAMING.client_object_id("  ", "AA:BB:CC:DD:EE:FF", "online"),
            "tenda_mw6_aabbccddeeff_online",
        )

    def test_name_of_only_special_characters_falls_back_to_mac(self) -> None:
        self.assertEqual(
            NAMING.client_object_id("***", "aa:bb:cc:dd:ee:ff", "node"),
            "tenda_mw6_aabbccddeeff_node",
        )


class RateTransferUniqueIdTest(unittest.TestCase):
    def test_matches_client_and_aggregate_rate_and_transfer(self) -> None:
        for unique_id in (
            "e_aa:bb:cc:dd:ee:ff_upload_rate",
            "e_aa:bb:cc:dd:ee:ff_download_transfer_total",
            "e_aa:bb:cc:dd:ee:ff_upload_transfer_day",
            "e_aggregate_download_rate",
            "e_aggregate_upload_transfer_month",
        ):
            self.assertTrue(NAMING.is_rate_or_transfer_unique_id(unique_id), unique_id)

    def test_ignores_other_entities(self) -> None:
        for unique_id in (
            "e_aa:bb:cc:dd:ee:ff_signal",
            "e_aa:bb:cc:dd:ee:ff_online",
            "e_transfer_counting_health",
            "e_qos_upload_cap",
            "e_node_sn_node_online",
            "e_transfer_unit",
            "e_dashboard_sort",
        ):
            self.assertFalse(NAMING.is_rate_or_transfer_unique_id(unique_id), unique_id)


class RemovableDeviceTest(unittest.TestCase):
    def test_hub_is_never_removable(self) -> None:
        self.assertFalse(NAMING.is_device_removable("e1", "e1", set(), set()))

    def test_absent_client_is_removable_present_client_is_not(self) -> None:
        self.assertTrue(
            NAMING.is_device_removable(
                "e1", "e1:aa:bb:cc:dd:ee:ff", {"11:22:33:44:55:66"}, set()
            )
        )
        self.assertFalse(
            NAMING.is_device_removable(
                "e1", "e1:aa:bb:cc:dd:ee:ff", {"aa:bb:cc:dd:ee:ff"}, set()
            )
        )

    def test_client_mac_comparison_ignores_case(self) -> None:
        self.assertFalse(
            NAMING.is_device_removable(
                "e1", "e1:aa:bb:cc:dd:ee:ff", {"AA:BB:CC:DD:EE:FF"}, set()
            )
        )

    def test_absent_node_is_removable_present_node_is_not(self) -> None:
        self.assertTrue(NAMING.is_device_removable("e1", "e1:node:SN1", set(), {"SN2"}))
        self.assertFalse(NAMING.is_device_removable("e1", "e1:node:SN1", set(), {"SN1"}))

    def test_other_entry_is_not_removable(self) -> None:
        self.assertFalse(
            NAMING.is_device_removable("e1", "e2:aa:bb:cc:dd:ee:ff", set(), set())
        )


def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    """Add the module's docstring examples to the unittest run (see test_api.py)."""
    tests.addTests(doctest.DocTestSuite(NAMING))
    return tests


if __name__ == "__main__":
    unittest.main()
