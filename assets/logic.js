// Logic thuần cho trang giá vàng: không đụng tới DOM, test bằng `node --test`.
// Giá trong nước lưu theo nghìn đồng/chỉ (đơn vị gốc của PNJ).

const HOUR_MS = 3600_000;
const CHANGE_TOLERANCE_MS = 90 * 60_000;

const round2 = (n) => Math.round(n * 100) / 100;

/** nghìn đồng/chỉ -> triệu đồng/lượng (1 lượng = 10 chỉ). */
export function toLuong(perChiThousand) {
  return perChiThousand == null ? null : round2(perChiThousand / 100);
}

/** nghìn đồng/chỉ -> triệu đồng/chỉ. */
export function toChi(perChiThousand) {
  return perChiThousand == null ? null : round2(perChiThousand / 1000);
}

export function latest(history) {
  return history.length ? history[history.length - 1] : null;
}

/** Giá trị gần nhất của một trường (bỏ qua những giờ nguồn đó bị lỗi), kèm thời điểm ghi. */
export function latestValue(history, field) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i][field] != null) return { value: history[i][field], t: history[i].t };
  }
  return null;
}

/** So giá trị mới nhất với bản ghi gần mốc 24 giờ trước nhất (trong ±90 phút). */
export function change24h(history, field) {
  const last = latestValue(history, field);
  if (!last) return null;
  const target = Date.parse(last.t) - 24 * HOUR_MS;
  let best = null;
  let bestDistance = Infinity;
  for (const record of history) {
    if (record[field] == null) continue;
    const distance = Math.abs(Date.parse(record.t) - target);
    if (distance <= CHANGE_TOLERANCE_MS && distance < bestDistance) {
      best = record;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const diff = round2(last.value - best[field]);
  return { diff, dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

export function isStale(latestIso, nowMs, hours = 3) {
  return nowMs - Date.parse(latestIso) > hours * HOUR_MS;
}

/** Một điểm cho mỗi giờ trong [sinceMs, untilMs]; giờ không có dữ liệu có y = null. */
export function hourlySeries(history, field, sinceMs, untilMs) {
  const byHour = new Map();
  for (const record of history) {
    if (record[field] == null) continue;
    const hour = Math.floor(Date.parse(record.t) / HOUR_MS) * HOUR_MS;
    byHour.set(hour, record[field]); // bản ghi sau ghi đè bản ghi trước cùng giờ
  }
  const series = [];
  for (let x = Math.floor(sinceMs / HOUR_MS) * HOUR_MS; x <= untilMs; x += HOUR_MS) {
    series.push({ x, y: byHour.has(x) ? byHour.get(x) : null });
  }
  return series;
}

export function segmentDir(y0, y1) {
  return y1 > y0 ? "up" : y1 < y0 ? "down" : "flat";
}

/** Đọc số người dùng nhập, chấp nhận cả "132,5" và "132.5". */
export function parseTarget(input) {
  const text = String(input ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

/** Giá bán (nghìn đồng/chỉ) đã xuống tới mức muốn mua (triệu đồng/lượng) chưa. */
export function targetHit(sellPerChiThousand, targetLuong) {
  if (sellPerChiThousand == null || targetLuong == null) return false;
  return toLuong(sellPerChiThousand) <= targetLuong;
}

/** Mức muốn mua lệch quá xa giá bán hiện tại (cả hai theo triệu/lượng): nhiều khả năng nhập nhầm đơn vị. */
export function targetLooksWrong(targetLuong, sellLuong) {
  if (targetLuong == null || sellLuong == null) return false;
  return targetLuong < sellLuong * 0.5 || targetLuong > sellLuong * 1.5;
}

/** Tiệm có giá thấp nhất trong danh sách {shop, value}; bỏ qua tiệm không có giá. */
export function cheapest(entries) {
  let best = null;
  for (const entry of entries) {
    if (entry.value != null && (best == null || entry.value < best.value)) best = entry;
  }
  return best;
}
