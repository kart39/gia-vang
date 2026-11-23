import {
  toLuong,
  toChi,
  latest,
  change24h,
  isStale,
  hourlySeries,
  segmentDir,
  parseTarget,
  targetHit,
  latestValue,
  targetLooksWrong,
  cheapest,
} from "./logic.js";

const DAY_MS = 24 * 3600_000;
const REFRESH_MS = 10 * 60_000;
const TARGETS_KEY = "giavang.targets";
const TZ = "Asia/Ho_Chi_Minh";

// Trường trong bản ghi: `${shop}_${kind}_${side}`, giá theo nghìn đồng/chỉ.
const SHOPS = [
  { id: "pnj", name: "PNJ", dash: [] },
  { id: "btmc", name: "Bảo Tín Minh Châu", dash: [6, 4] },
];
const KINDS = [
  { id: "ring", name: "Nhẫn trơn 999.9" },
  { id: "sjc", name: "Vàng miếng SJC" },
];
const field = (shop, kind, side) => `${shop}_${kind}_${side}`;

const state = { history: [], kind: "ring", days: 7, loadError: false };
let chart = null;

const $ = (selector, root = document) => root.querySelector(selector);

const formatVnd = (n) =>
  n == null ? "–" : n.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric",
});
const hourParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hour: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit",
});
function hourLabel(ms) {
  const p = Object.fromEntries(hourParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.hour}:00 ${p.day}/${p.month}`;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Mỗi trường lấy giá trị gần nhất của riêng nó: giờ nào một nguồn lỗi thì vẫn giữ giá cũ của nguồn đó.
const valueOf = (name) => latestValue(state.history, name)?.value ?? null;

/** Tiệm đang bán rẻ nhất cho một loại vàng: {shop, value} hoặc null. */
function cheapestSell(kind) {
  return cheapest(SHOPS.map((shop) => ({ shop: shop.name, value: valueOf(field(shop.id, kind, "sell")) })));
}

// ---------- Giá muốn mua (lưu trong trình duyệt) ----------

function loadTargets() {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGETS_KEY) || "{}");
    return { ring: typeof saved.ring === "number" ? saved.ring : null, sjc: typeof saved.sjc === "number" ? saved.sjc : null };
  } catch {
    return { ring: null, sjc: null };
  }
}

function saveTargets(targets) {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
  } catch {
    // Trình duyệt chặn lưu trữ: mức giá chỉ có hiệu lực tới khi đóng trang.
  }
}

let targets = loadTargets();

// ---------- Bảng giá ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function changeLine(change) {
  const line = el("div", "row__change");
  if (!change) return line;
  const arrow = { up: "▲", down: "▼", flat: "■" }[change.dir];
  const amount = change.dir === "flat" ? "không đổi" : formatVnd(Math.abs(toLuong(change.diff)));
  line.textContent = `${arrow} ${amount} trong 24 giờ`;
  line.dataset.dir = change.dir;
  return line;
}

function priceRow(shop, kind) {
  const buy = valueOf(field(shop.id, kind.id, "buy"));
  const sell = valueOf(field(shop.id, kind.id, "sell"));
  const row = el("div", "row");
  row.append(el("div", "row__name", shop.name), el("div", "row__price", formatVnd(toLuong(buy))));
  const sellCell = el("div", "row__price row__price--sell");
  sellCell.append(el("span", null, formatVnd(toLuong(sell))));
  const perChi = toChi(sell);
  sellCell.append(el("small", null, perChi == null ? "" : `${formatVnd(perChi)} triệu/chỉ`));
  row.append(sellCell, changeLine(change24h(state.history, field(shop.id, kind.id, "sell"))));
  return row;
}

function renderBoard() {
  const last = latest(state.history);
  $("#updated").textContent = last
    ? `Cập nhật lúc ${dateTime.format(new Date(last.t))}`
    : state.loadError ? "Không tải được dữ liệu" : "Chưa có dữ liệu";

  const rows = [];
  for (const kind of KINDS) {
    rows.push(el("h2", "group", kind.name));
    for (const shop of SHOPS) rows.push(priceRow(shop, kind));
  }
  $("#board-rows").replaceChildren(...rows);
}

// ---------- Thông báo ----------

function notice(kind, text) {
  return el("p", `notice notice--${kind}`, text);
}

/** Thời điểm gần nhất một tiệm còn trả về giá (bất kỳ loại vàng nào). */
function shopLastSeen(shop) {
  const times = KINDS.map((kind) => latestValue(state.history, field(shop.id, kind.id, "sell"))?.t)
    .filter(Boolean)
    .map(Date.parse);
  return times.length ? Math.max(...times) : null;
}

function renderNotices() {
  const items = [];
  const last = latest(state.history);
  const now = Date.now();

  if (state.loadError) {
    items.push(notice("warn", "Không tải được giá mới. Kiểm tra kết nối mạng, trang sẽ tự thử lại sau 10 phút."));
  }
  if (!last && !state.loadError) {
    items.push(notice("warn", "Chưa có dữ liệu. Lần ghi giá đầu tiên sẽ có trong vòng 1 giờ."));
  }
  if (last && isStale(last.t, now)) {
    items.push(notice("warn", `Giá chưa được cập nhật từ ${dateTime.format(new Date(last.t))}, số trên bảng có thể đã cũ.`));
  } else if (last) {
    // Bản ghi mới nhất còn mới nhưng một tiệm có thể đã lỗi nhiều giờ liền.
    for (const shop of SHOPS) {
      const seen = shopLastSeen(shop);
      if (seen != null && isStale(new Date(seen).toISOString(), now)) {
        items.push(notice("warn", `Giá ${shop.name} chưa cập nhật từ ${dateTime.format(new Date(seen))}, số của tiệm này có thể đã cũ.`));
      }
    }
  }
  for (const kind of KINDS) {
    const best = cheapestSell(kind.id);
    if (best && targetHit(best.value, targets[kind.id])) {
      items.push(notice("hit",
        `${kind.name}: ${best.shop} đang bán ${formatVnd(toLuong(best.value))} triệu/lượng, đã xuống tới mức bạn muốn mua (${formatVnd(targets[kind.id])}).`));
    }
  }
  $("#notices").replaceChildren(...items);
}

// ---------- Biểu đồ ----------

function renderChart() {
  const canvas = $("#chart");
  const empty = $("#chart-empty");
  const now = Date.now();
  const since = now - state.days * DAY_MS;
  const lines = SHOPS.map((shop) => {
    const raw = hourlySeries(state.history, field(shop.id, state.kind, "sell"), since, now);
    return { shop, raw, values: raw.map((p) => toLuong(p.y)) };
  });

  if (!lines.some((line) => line.values.some((v) => v != null))) {
    chart?.destroy();
    chart = null;
    canvas.hidden = true;
    empty.hidden = false;
    empty.textContent = state.history.length
      ? "Chưa có giá nào trong khoảng thời gian này."
      : "Biểu đồ sẽ hiện khi đã ghi được giá.";
    return;
  }
  canvas.hidden = false;
  empty.hidden = true;

  const colors = { up: cssVar("--up"), down: cssVar("--down"), flat: cssVar("--flat") };
  const ink = cssVar("--muted");
  const grid = cssVar("--line");

  const datasets = lines.map(({ shop, values }) => ({
    label: shop.name,
    data: values,
    spanGaps: false,
    borderWidth: 2,
    borderDash: shop.dash,
    tension: 0,
    // Điểm đứng một mình giữa hai giờ trống thì không có đoạn nối, nên vẽ chấm để vẫn thấy.
    pointRadius: values.map((v, i) => (v != null && values[i - 1] == null && values[i + 1] == null ? 2.5 : 0)),
    pointHoverRadius: 4,
    pointBackgroundColor: colors.flat,
    borderColor: colors.flat,
    segment: {
      borderColor: (ctx) => colors[segmentDir(ctx.p0.parsed.y, ctx.p1.parsed.y)],
    },
  }));

  const config = {
    type: "line",
    data: { labels: lines[0].raw.map((p) => hourLabel(p.x)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y == null ? "không có dữ liệu" : `${formatVnd(ctx.parsed.y)} triệu/lượng`}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: ink,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 4,
            font: { family: "Be Vietnam Pro" },
            // Khoảng nhiều ngày chỉ ghi ngày cho đỡ chật; tooltip vẫn có đủ giờ.
            callback(value) {
              const label = this.getLabelForValue(value);
              return state.days === 1 ? label : label.split(" ")[1];
            },
          },
          grid: { display: false },
        },
        y: {
          ticks: { color: ink, callback: (v) => formatVnd(v), font: { family: "Be Vietnam Pro" } },
          grid: { color: grid },
        },
      },
    },
  };

  chart?.destroy();
  chart = new Chart(canvas, config);
}

// ---------- Điều khiển ----------

function bindSegment(groupId, onPick) {
  const group = $(`#${groupId}`);
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
    onPick(button);
    renderChart();
  });
}

function renderTargetHints() {
  const form = $("#targets");
  const messages = [];
  for (const kind of KINDS) {
    const text = form.elements[kind.id].value.trim();
    if (text && parseTarget(text) == null) {
      messages.push(`${kind.name}: nhập giá bằng số, ví dụ 130,5.`);
      continue;
    }
    const best = cheapestSell(kind.id);
    const sell = best ? toLuong(best.value) : null;
    if (targetLooksWrong(targets[kind.id], sell)) {
      messages.push(`${kind.name}: giá bán hiện tại khoảng ${formatVnd(sell)} triệu/lượng. Kiểm tra lại, mức giá cần nhập theo triệu đồng/lượng.`);
    }
  }
  $("#target-error").textContent = messages.join(" ");
}

function bindTargets() {
  const form = $("#targets");
  for (const kind of KINDS) {
    const input = form.elements[kind.id];
    if (targets[kind.id] != null) input.value = String(targets[kind.id]).replace(".", ",");
    input.addEventListener("input", () => {
      const text = input.value.trim();
      const value = parseTarget(text);
      if (!text || value != null) {
        targets = { ...targets, [kind.id]: value };
        saveTargets(targets);
        renderNotices();
      }
      renderTargetHints();
    });
  }
  form.addEventListener("submit", (event) => event.preventDefault());
}

// ---------- Tải dữ liệu ----------

async function load() {
  try {
    const response = await fetch(`data/history.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.history = Array.isArray(data) ? data : [];
    state.loadError = false;
  } catch {
    state.loadError = true;
  }
  renderBoard();
  renderNotices();
  renderTargetHints();
  renderChart();
}

bindSegment("seg-series", (b) => { state.kind = b.dataset.kind; });
bindSegment("seg-range", (b) => { state.days = Number(b.dataset.days); });
bindTargets();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderChart);
load();
setInterval(load, REFRESH_MS);
