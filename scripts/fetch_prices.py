"""Lấy giá vàng hiện tại (Hà Nội) và ghi thêm một bản ghi vào data/history.json.

Chạy mỗi giờ bởi GitHub Actions. Chỉ dùng thư viện chuẩn của Python.
Mọi giá đều lưu theo nghìn đồng/chỉ.
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# zone=11 là chi nhánh Hà Nội (payload trả về "chinhanh": "hanoi").
PNJ_URL = "https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=11"
BTMC_URL = "https://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v"
HISTORY_PATH = Path(__file__).resolve().parent.parent / "data" / "history.json"

# Mã sản phẩm PNJ -> tên loại vàng trong bản ghi. PNJ tính theo nghìn đồng/chỉ.
PNJ_PRODUCTS = {"SJC": "sjc", "N24K": "ring"}
# Tên sản phẩm BTMC -> tên loại vàng. BTMC tính theo đồng/chỉ.
BTMC_PRODUCTS = {
    "VÀNG MIẾNG SJC (Vàng SJC)": "sjc",
    "NHẪN TRÒN TRƠN (Vàng Rồng Thăng Long)": "ring",
}
# Giá ngoài khoảng này (nghìn đồng/chỉ) gần như chắc chắn là lỗi dữ liệu: 0 khi tạm ngưng
# bán, hoặc nguồn đổi đơn vị. Bỏ đi để không báo nhầm "đã chạm giá muốn mua".
PLAUSIBLE = (1_000, 100_000)


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


def _plausible(value):
    if value is None:
        return None
    low, high = PLAUSIBLE
    if not low <= value <= high:
        print(f"Bỏ giá bất thường: {value}", file=sys.stderr)
        return None
    return value


def _empty(source):
    return {f"{source}_{kind}_{side}": None for kind in ("sjc", "ring") for side in ("buy", "sell")}


def parse_pnj(payload):
    result = _empty("pnj")
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return result
    for item in items:
        if not isinstance(item, dict) or item.get("masp") not in PNJ_PRODUCTS:
            continue
        kind = PNJ_PRODUCTS[item["masp"]]
        result[f"pnj_{kind}_buy"] = _plausible(_to_int(item.get("giamua")))
        result[f"pnj_{kind}_sell"] = _plausible(_to_int(item.get("giaban")))
    return result


def _btmc_thousands(value):
    number = _to_int(value)
    return None if number is None else _plausible(round(number / 1000))


def parse_btmc(payload):
    """BTMC trả về nhiều mốc giờ cho cùng một sản phẩm; lấy mốc mới nhất."""
    result = _empty("btmc")
    try:
        items = payload["DataList"]["Data"]
    except (TypeError, KeyError):
        return result
    if not isinstance(items, list):
        return result
    newest = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        row = item.get("@row")
        kind = BTMC_PRODUCTS.get(item.get(f"@n_{row}"))
        if kind is None:
            continue
        try:
            when = datetime.strptime(item.get(f"@d_{row}", ""), "%d/%m/%Y %H:%M")
        except ValueError:
            continue
        if kind not in newest or when > newest[kind][0]:
            newest[kind] = (when, item.get(f"@pb_{row}"), item.get(f"@ps_{row}"))
    for kind, (_, buy, sell) in newest.items():
        result[f"btmc_{kind}_buy"] = _btmc_thousands(buy)
        result[f"btmc_{kind}_sell"] = _btmc_thousands(sell)
    return result


def build_record(now, *parts):
    prices = {}
    for part in parts:
        prices.update(part)
    if all(value is None for value in prices.values()):
        return None
    return {"t": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **prices}


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
    btmc = parse_btmc(fetch_json(BTMC_URL))
    record = build_record(datetime.now(timezone.utc), pnj, btmc)
    if record is None:
        print("Cả hai nguồn đều lỗi, bỏ qua lần này.")
        return 0
    append_record(HISTORY_PATH, record)
    print(f"Đã ghi: {record}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
