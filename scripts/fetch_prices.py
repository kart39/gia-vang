"""Lấy giá vàng hiện tại và ghi thêm một bản ghi vào data/history.json.

Chạy mỗi giờ bởi GitHub Actions. Chỉ dùng thư viện chuẩn của Python.
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PNJ_URL = "https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00"
XAU_URL = "https://api.gold-api.com/price/XAU"
HISTORY_PATH = Path(__file__).resolve().parent.parent / "data" / "history.json"

# Mã sản phẩm của PNJ -> tiền tố trường trong bản ghi.
# Giá PNJ tính theo nghìn đồng/chỉ.
PNJ_PRODUCTS = {"SJC": "sjc", "N24K": "ring"}


def fetch_json(url, timeout=20):
    """Trả về JSON đã parse, hoặc None nếu có bất kỳ lỗi nào."""
    request = urllib.request.Request(url, headers={"User-Agent": "gia-vang-tracker/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # mạng, HTTP, JSON hỏng... đều coi là không có dữ liệu
        print(f"Lỗi khi lấy {url}: {error}", file=sys.stderr)
        return None


def _to_int(value):
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_pnj(payload):
    result = {f"{prefix}_{side}": None for prefix in PNJ_PRODUCTS.values() for side in ("buy", "sell")}
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return result
    for item in items:
        if not isinstance(item, dict) or item.get("masp") not in PNJ_PRODUCTS:
            continue
        prefix = PNJ_PRODUCTS[item["masp"]]
        result[f"{prefix}_buy"] = _to_int(item.get("giamua"))
        result[f"{prefix}_sell"] = _to_int(item.get("giaban"))
    return result


def parse_xau(payload):
    if not isinstance(payload, dict):
        return None
    try:
        return round(float(payload["price"]), 2)
    except (KeyError, TypeError, ValueError):
        return None


def build_record(now, pnj, xau):
    if xau is None and all(value is None for value in pnj.values()):
        return None
    record = {"t": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    record.update(pnj)
    record["xau_usd"] = xau
    return record


def append_record(path, record):
    path = Path(path)
    history = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    history.append(record)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Mỗi bản ghi một dòng để diff trong git gọn.
    lines = ",\n".join(json.dumps(item, ensure_ascii=False) for item in history)
    path.write_text(f"[\n{lines}\n]\n" if history else "[]\n", encoding="utf-8")


def main():
    pnj = parse_pnj(fetch_json(PNJ_URL))
    xau = parse_xau(fetch_json(XAU_URL))
    record = build_record(datetime.now(timezone.utc), pnj, xau)
    if record is None:
        print("Cả hai nguồn đều lỗi, bỏ qua lần này.")
        return 0
    append_record(HISTORY_PATH, record)
    print(f"Đã ghi: {record}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
