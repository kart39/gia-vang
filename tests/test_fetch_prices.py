import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from fetch_prices import append_record, build_record, fetch_json, parse_pnj, parse_xau  # noqa: E402

EMPTY_PNJ = {"sjc_buy": None, "sjc_sell": None, "ring_buy": None, "ring_sell": None}
NOW = datetime(2026, 11, 23, 9, 5, 0, tzinfo=timezone.utc)


class ParsePnjTest(unittest.TestCase):
    def test_parse_pnj_extracts_sjc_and_ring(self):
        payload = {
            "data": [
                {"masp": "SJC", "tensp": "Vàng miếng SJC 999.9", "giaban": 13500, "giamua": 13000},
                {"masp": "N24K", "tensp": "Nhẫn Trơn PNJ 999.9", "giaban": 13250, "giamua": 12700},
                {"masp": "24K", "giaban": 13050, "giamua": 12500},
            ]
        }
        self.assertEqual(
            parse_pnj(payload),
            {"sjc_buy": 13000, "sjc_sell": 13500, "ring_buy": 12700, "ring_sell": 13250},
        )

    def test_parse_pnj_missing_product_gives_none(self):
        payload = {"data": [{"masp": "SJC", "giaban": 13500, "giamua": 13000}]}
        result = parse_pnj(payload)
        self.assertEqual(result["sjc_sell"], 13500)
        self.assertIsNone(result["ring_buy"])
        self.assertIsNone(result["ring_sell"])

    def test_parse_pnj_bad_payload(self):
        for payload in (None, {}, {"data": "x"}, {"data": [None, "x", {"masp": "SJC"}]}):
            with self.subTest(payload=payload):
                self.assertEqual(parse_pnj(payload), EMPTY_PNJ)


class ParseXauTest(unittest.TestCase):
    def test_parse_xau(self):
        self.assertEqual(parse_xau({"price": 3613.050049}), 3613.05)

    def test_parse_xau_bad_payload(self):
        for payload in (None, {}, {"price": "abc"}):
            with self.subTest(payload=payload):
                self.assertIsNone(parse_xau(payload))


class BuildRecordTest(unittest.TestCase):
    def test_build_record_partial(self):
        record = build_record(NOW, dict(EMPTY_PNJ), 3613.05)
        self.assertEqual(
            record,
            {
                "t": "2026-11-23T09:05:00Z",
                "sjc_buy": None,
                "sjc_sell": None,
                "ring_buy": None,
                "ring_sell": None,
                "xau_usd": 3613.05,
            },
        )

    def test_build_record_all_failed_returns_none(self):
        self.assertIsNone(build_record(NOW, dict(EMPTY_PNJ), None))


class AppendRecordTest(unittest.TestCase):
    def test_append_record_creates_and_appends(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data" / "history.json"
            rec = {"t": "2026-11-23T09:05:00Z", "xau_usd": 1.0}
            rec2 = {"t": "2026-11-23T10:05:00Z", "xau_usd": 2.0}
            append_record(path, rec)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), [rec])
            append_record(path, rec2)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), [rec, rec2])


class FetchJsonTest(unittest.TestCase):
    def test_fetch_json_returns_none_on_error(self):
        self.assertIsNone(fetch_json("http://127.0.0.1:9/", timeout=2))


if __name__ == "__main__":
    unittest.main()
