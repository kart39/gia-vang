import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from fetch_prices import append_record, build_record, fetch_json, parse_btmc, parse_pnj  # noqa: E402

EMPTY_PNJ = {"pnj_sjc_buy": None, "pnj_sjc_sell": None, "pnj_ring_buy": None, "pnj_ring_sell": None}
EMPTY_BTMC = {"btmc_sjc_buy": None, "btmc_sjc_sell": None, "btmc_ring_buy": None, "btmc_ring_sell": None}
NOW = datetime(2026, 11, 23, 9, 5, 0, tzinfo=timezone.utc)


def btmc_row(row, name, buy, sell, when):
    return {
        "@row": str(row),
        f"@n_{row}": name,
        f"@k_{row}": "24k",
        f"@h_{row}": "999.9",
        f"@pb_{row}": str(buy),
        f"@ps_{row}": str(sell),
        f"@d_{row}": when,
    }


SJC = "VÀNG MIẾNG SJC (Vàng SJC)"
RING = "NHẪN TRÒN TRƠN (Vàng Rồng Thăng Long)"


class ParsePnjTest(unittest.TestCase):
    def test_parse_pnj_extracts_sjc_and_ring(self):
        payload = {
            "chinhanh": "hanoi",
            "data": [
                {"masp": "SJC", "tensp": "Vàng miếng SJC 999.9", "giaban": 13500, "giamua": 13000},
                {"masp": "N24K", "tensp": "Nhẫn Trơn PNJ 999.9", "giaban": 13250, "giamua": 12700},
                {"masp": "24K", "giaban": 13050, "giamua": 12500},
            ],
        }
        self.assertEqual(
            parse_pnj(payload),
            {"pnj_sjc_buy": 13000, "pnj_sjc_sell": 13500, "pnj_ring_buy": 12700, "pnj_ring_sell": 13250},
        )

    def test_parse_pnj_missing_product_gives_none(self):
        payload = {"data": [{"masp": "SJC", "giaban": 13500, "giamua": 13000}]}
        result = parse_pnj(payload)
        self.assertEqual(result["pnj_sjc_sell"], 13500)
        self.assertIsNone(result["pnj_ring_buy"])
        self.assertIsNone(result["pnj_ring_sell"])

    def test_parse_pnj_rejects_implausible_prices(self):
        # 0 = sản phẩm tạm ngưng; 13250000 = đổi đơn vị sang đồng; -1 = rác
        for bad in (0, -1, 13250000, 500):
            with self.subTest(bad=bad):
                payload = {"data": [{"masp": "N24K", "giaban": bad, "giamua": 12700}]}
                result = parse_pnj(payload)
                self.assertIsNone(result["pnj_ring_sell"])
                self.assertEqual(result["pnj_ring_buy"], 12700)

    def test_parse_pnj_bad_payload(self):
        for payload in (None, {}, {"data": "x"}, {"data": [None, "x", {"masp": "SJC"}]}):
            with self.subTest(payload=payload):
                self.assertEqual(parse_pnj(payload), EMPTY_PNJ)


class ParseBtmcTest(unittest.TestCase):
    def test_parse_btmc_takes_latest_entry_and_converts_to_thousands(self):
        payload = {
            "DataList": {
                "Data": [
                    btmc_row(1, "BẠC MIẾNG PHÚ QUÝ Ag 999 1 LƯỢNG (PHÚ QUÝ)", 1331000, 1372000, "23/11/2026 16:34"),
                    btmc_row(272, SJC, 12950000, 13500000, "23/11/2026 15:13"),
                    btmc_row(277, RING, 12950000, 13450000, "23/11/2026 15:13"),
                    btmc_row(457, SJC, 12900000, 13400000, "23/11/2026 14:21"),
                    btmc_row(460, RING, 12900000, 13400000, "22/11/2026 16:00"),
                ]
            }
        }
        self.assertEqual(
            parse_btmc(payload),
            {"btmc_sjc_buy": 12950, "btmc_sjc_sell": 13500, "btmc_ring_buy": 12950, "btmc_ring_sell": 13450},
        )

    def test_parse_btmc_older_entry_listed_first_still_loses(self):
        payload = {
            "DataList": {
                "Data": [
                    btmc_row(1, RING, 12000000, 12500000, "01/12/2025 09:00"),
                    btmc_row(2, RING, 12950000, 13450000, "23/11/2026 15:13"),
                ]
            }
        }
        self.assertEqual(parse_btmc(payload)["btmc_ring_sell"], 13450)

    def test_parse_btmc_rejects_zero_sell_price(self):
        payload = {"DataList": {"Data": [btmc_row(1, SJC, 12950000, 0, "23/11/2026 15:13")]}}
        result = parse_btmc(payload)
        self.assertIsNone(result["btmc_sjc_sell"])
        self.assertEqual(result["btmc_sjc_buy"], 12950)

    def test_parse_btmc_bad_payload(self):
        for payload in (None, {}, {"DataList": {}}, {"DataList": {"Data": "x"}}, {"DataList": {"Data": [None, {"@row": "1"}]}}):
            with self.subTest(payload=payload):
                self.assertEqual(parse_btmc(payload), EMPTY_BTMC)


class BuildRecordTest(unittest.TestCase):
    def test_build_record_partial(self):
        btmc = dict(EMPTY_BTMC, btmc_ring_sell=13450)
        record = build_record(NOW, dict(EMPTY_PNJ), btmc)
        self.assertEqual(record["t"], "2026-11-23T09:05:00Z")
        self.assertEqual(record["btmc_ring_sell"], 13450)
        self.assertIsNone(record["pnj_sjc_sell"])
        self.assertEqual(set(record), {"t"} | set(EMPTY_PNJ) | set(EMPTY_BTMC))

    def test_build_record_all_failed_returns_none(self):
        self.assertIsNone(build_record(NOW, dict(EMPTY_PNJ), dict(EMPTY_BTMC)))


class AppendRecordTest(unittest.TestCase):
    def test_append_record_creates_and_appends(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data" / "history.json"
            rec = {"t": "2026-11-23T09:05:00Z", "pnj_sjc_sell": 1}
            rec2 = {"t": "2026-11-23T10:05:00Z", "pnj_sjc_sell": 2}
            append_record(path, rec)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), [rec])
            append_record(path, rec2)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), [rec, rec2])


class FetchJsonTest(unittest.TestCase):
    def test_fetch_json_returns_none_on_error(self):
        self.assertIsNone(fetch_json("http://127.0.0.1:9/", timeout=2))


if __name__ == "__main__":
    unittest.main()
