from __future__ import annotations

import doctest
import importlib.util
import sys
from pathlib import Path
import unittest


API_PATH = Path(__file__).parents[1] / "custom_components" / "tenda_mw6" / "api.py"
SPEC = importlib.util.spec_from_file_location("tenda_mw6_api_test", API_PATH)
assert SPEC is not None and SPEC.loader is not None
API = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = API
SPEC.loader.exec_module(API)


class InventorySummaryTest(unittest.TestCase):
    def client(self, raw_online: int | None) -> object:
        return API.TendaMW6Client(
            ip="", mac="", name="", node_sn="", signal=None, access=None,
            condition_time=None, raw_online=raw_online, raw_uprate=None,
            raw_downrate=None,
        )

    def test_all_reported_offline_is_explicit(self) -> None:
        summary = API.summarize_inventory([self.client(0), self.client(0)])
        self.assertTrue(summary.all_reported_offline)
        self.assertEqual(summary.total_clients, 2)
        self.assertEqual(summary.reported_offline, 2)
        self.assertEqual(summary.reported_online, 0)

    def test_online_or_unknown_record_prevents_global_offline_flag(self) -> None:
        summary = API.summarize_inventory([self.client(1), self.client(None)])
        self.assertFalse(summary.all_reported_offline)
        self.assertEqual(summary.reported_online, 1)
        self.assertEqual(summary.unknown_online_state, 1)

    def test_decode_preserves_text_access_field(self) -> None:
        host = b"\x1a\x05wired"
        payload = b"\x00\x00\x00\x00\x0a" + bytes([len(host)]) + host

        status, clients = API._decode_mesh_hosts(payload)

        self.assertEqual(status, 0)
        self.assertEqual(len(clients), 1)
        self.assertEqual(clients[0].access, "wired")

    def test_build_login_payload_uses_serial_as_qrmsg(self) -> None:
        """The LoginMsg must carry the serial number in the qrmsg field (field 2)."""
        serial = "E00000000000000000"
        payload = API.build_login_payload(serial)
        # Expected protobuf format: tag 0x12 (field 2, length-delimited) + length + ASCII serial.
        self.assertEqual(payload, b"\x12" + bytes([len(serial)]) + serial.encode("ascii"))

    def test_build_login_payload_rejects_empty_serial(self) -> None:
        with self.assertRaises(ValueError):
            API.build_login_payload("")

    def test_build_login_payload_rejects_invalid_serial(self) -> None:
        with self.assertRaises(ValueError):
            API.build_login_payload("bad serial !")

    def test_build_login_payload_trims_surrounding_whitespace(self) -> None:
        serial = "E00000000000000000"
        self.assertEqual(
            API.build_login_payload(f"  {serial}\n"),
            b"\x12" + bytes([len(serial)]) + serial.encode("ascii"),
        )

    def test_decode_qos_extracts_up_and_down_caps(self) -> None:
        """QOS_GET exposes the up/down bandwidth caps (fields 2 and 3)."""
        # Observed frame: status (4 bytes) then protobuf
        #   08 00            field 1 = 0
        #   10 80 c0 3e      field 2 (up)   = 1,024,000
        #   18 80 c0 3e      field 3 (down) = 1,024,000
        #   20 00            field 4 = 0
        payload = bytes.fromhex("0000000008001080c03e1880c03e2000")
        qos = API._decode_qos(payload)
        self.assertEqual(qos.up_cap, 1_024_000)
        self.assertEqual(qos.down_cap, 1_024_000)

    def test_decode_qos_handles_missing_fields(self) -> None:
        """Without cap fields, values stay None rather than raising."""
        qos = API._decode_qos(b"\x00\x00\x00\x00")
        self.assertIsNone(qos.up_cap)
        self.assertIsNone(qos.down_cap)

    def test_estimate_transfer_uses_kib_per_second(self) -> None:
        self.assertEqual(API.estimate_transfer_bytes(3, 10.5), 32256.0)
        self.assertEqual(API.estimate_transfer_bytes(None, 10), 0.0)
        self.assertEqual(API.estimate_transfer_bytes(-1, 10), 0.0)

    def test_transfer_readiness_requires_online_client_and_nonzero_rate(self) -> None:
        offline = self.client(0)
        offline.raw_uprate = 12
        online_zero = self.client(1)
        online_rate = self.client(1)
        online_rate.raw_downrate = 42

        readiness = API.summarize_transfer_readiness(
            [offline, online_zero, online_rate]
        )

        self.assertEqual(readiness.eligible_clients, 2)
        self.assertEqual(readiness.clients_with_rate, 1)
        self.assertEqual(readiness.clients_with_upload_rate, 0)
        self.assertEqual(readiness.clients_with_download_rate, 1)
        self.assertFalse(readiness.inventory_all_reported_offline)

    def test_connection_type_prefers_firmware_access_field(self) -> None:
        """A known word in the firmware ``access`` field wins over the signal."""
        wired = self.client(1)
        wired.access = "Wired"
        wired.signal = -40
        self.assertEqual(API.client_connection_type(wired), "wired")

    def test_connection_type_is_wifi_when_a_signal_is_reported(self) -> None:
        wifi = self.client(1)
        wifi.signal = -61
        self.assertEqual(API.client_connection_type(wifi), "wifi")

    def test_connection_type_is_wired_for_online_client_without_signal(self) -> None:
        self.assertEqual(API.client_connection_type(self.client(1)), "wired")

    def test_connection_type_is_unknown_for_offline_client_without_signal(self) -> None:
        """An offline client keeps no signal: wired must not be guessed."""
        self.assertIsNone(API.client_connection_type(self.client(0)))
        self.assertIsNone(API.client_connection_type(self.client(None)))


class NodeSummaryTest(unittest.TestCase):
    """summarize_nodes groups the HostList per mesh node without querying nodes."""

    def client(
        self,
        mac: str,
        node_sn: str,
        raw_online: int | None,
        signal: int | None,
    ) -> object:
        return API.TendaMW6Client(
            ip="", mac=mac, name="", node_sn=node_sn, signal=signal, access=None,
            condition_time=None, raw_online=raw_online, raw_uprate=None,
            raw_downrate=None,
        )

    def test_groups_and_counts_per_node(self) -> None:
        summaries = API.summarize_nodes([
            self.client("aa", "SN1", 1, -45),
            self.client("bb", "SN1", 1, -72),
            self.client("cc", "SN1", 1, None),   # wired
            self.client("dd", "SN1", 0, -30),    # offline
            self.client("ee", "SN2", 1, -50),
        ])
        self.assertEqual(set(summaries), {"SN1", "SN2"})
        node = summaries["SN1"]
        self.assertEqual(node.total_clients, 4)
        self.assertEqual(node.online_clients, 3)
        self.assertEqual(node.wifi_clients, 2)
        self.assertEqual(node.weakest_signal, -72)
        self.assertEqual(node.weakest_client_mac, "bb")

    def test_offline_and_wired_clients_never_define_weakest_signal(self) -> None:
        summaries = API.summarize_nodes([
            self.client("aa", "SN1", 0, -90),
            self.client("bb", "SN1", 1, None),
        ])
        self.assertIsNone(summaries["SN1"].weakest_signal)
        self.assertIsNone(summaries["SN1"].weakest_client_mac)
        self.assertEqual(summaries["SN1"].wifi_clients, 0)

    def test_clients_without_node_are_ignored(self) -> None:
        self.assertEqual(API.summarize_nodes([self.client("aa", "", 1, -40)]), {})

    def test_empty_list(self) -> None:
        self.assertEqual(API.summarize_nodes([]), {})



def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    """Add the module's docstring examples to the unittest run.

    The module is the one loaded above from its file path, so its directory is
    never put on ``sys.path``. ``python -m doctest <file>`` does put it there, and
    the integration's ``select.py`` then shadows the standard ``select`` module
    (imported by ``socket``), which fails without Home Assistant installed.
    """
    tests.addTests(doctest.DocTestSuite(API))
    return tests


if __name__ == "__main__":
    unittest.main()
