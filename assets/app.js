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
} from "./logic.js";

const DAY_MS = 24 * 3600_000;
const REFRESH_MS = 10 * 60_000;
const TARGETS_KEY = "giavang.targets";
const TZ = "Asia/Ho_Chi_Minh";

const PRODUCTS = {
  ring: { name: "Nhẫn trơn 999.9", buy: "ring_buy", sell: "ring_sell" },
  sjc: { name: "Vàng miếng SJC", buy: "sjc_buy", sell: "sjc_sell" },
};

const state = { history: [], series: "ring_sell", days: 7, loadError: false };
let chart = null;

const $ = (selector, root = document) => root.querySelector(selector);

const formatVnd = (n) =>
  n == null ? "–" : n.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const formatUsd = (n) =>
  n == null ? "–" : n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

function renderChange(el, change, toDisplay, format) {
  if (!change) {
    el.textContent = "";
    el.removeAttribute("data-dir");
    return;
  }
  const arrow = { up: "▲", down: "▼", flat: "■" }[change.dir];
  const amount = change.dir === "flat" ? "không đổi" : format(Math.abs(toDisplay(change.diff)));
  el.textContent = `${arrow} ${amount} trong 24 giờ`;
  el.dataset.dir = change.dir;
}

function renderBoard() {
  const last = latest(state.history);
  const updated = $("#updated");
  if (!last) {
    updated.textContent = state.loadError ? "Không tải được dữ liệu" : "Chưa có dữ liệu";
  } else {
    updated.textContent = `Cập nhật lúc ${dateTime.format(new Date(last.t))}`;
  }

  for (const [key, product] of Object.entries(PRODUCTS)) {
    const row = $(`#row-${key}`);
    $("[data-buy]", row).textContent = formatVnd(toLuong(last?.[product.buy] ?? null));
    $("[data-sell]", row).textContent = formatVnd(toLuong(last?.[product.sell] ?? null));
    const perChi = toChi(last?.[product.sell] ?? null);
    $("[data-sell-chi]", row).textContent = perChi == null ? "" : `${formatVnd(perChi)} triệu/chỉ`;
    renderChange($("[data-change]", row), change24h(state.history, product.sell), toLuong, formatVnd);
  }

  const xauRow = $("#row-xau");
  $("[data-sell]", xauRow).textContent = formatUsd(last?.xau_usd ?? null);
  renderChange($("[data-change]", xauRow), change24h(state.history, "xau_usd"), (n) => n, formatUsd);
}

// ---------- Thông báo ----------

function notice(kind, text) {
  const p = document.createElement("p");
  p.className = `notice notice--${kind}`;
  p.textContent = text;
  return p;
}

function renderNotices() {
  const box = $("#notices");
  const items = [];
  const last = latest(state.history);

  if (state.loadError) {
    items.push(notice("warn", "Không tải được giá mới. Kiểm tra kết nối mạng, trang sẽ tự thử lại sau 10 phút."));
  }
  if (!last && !state.loadError) {
    items.push(notice("warn", "Chưa có dữ liệu. Lần ghi giá đầu tiên sẽ có trong vòng 1 giờ."));
  }
  if (last && isStale(last.t, Date.now())) {
    items.push(notice("warn", `Giá chưa được cập nhật từ ${dateTime.format(new Date(last.t))}, số trên bảng có thể đã cũ.`));
  }
  for (const [key, product] of Object.entries(PRODUCTS)) {
    const sell = last?.[product.sell] ?? null;
    if (targetHit(sell, targets[key])) {
      items.push(notice("hit",
        `${product.name} đang bán ${formatVnd(toLuong(sell))} triệu/lượng, đã xuống tới mức bạn muốn mua (${formatVnd(targets[key])}).`));
    }
  }
  box.replaceChildren(...items);
}

// ---------- Biểu đồ ----------

function renderChart() {
  const canvas = $("#chart");
  const empty = $("#chart-empty");
  const now = Date.now();
  const isDomestic = state.series !== "xau_usd";
  const raw = hourlySeries(state.history, state.series, now - state.days * DAY_MS, now);
  const values = raw.map((p) => (p.y == null ? null : isDomestic ? toLuong(p.y) : p.y));

  if (!values.some((v) => v != null)) {
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
  // Điểm đứng một mình giữa hai giờ trống thì không có đoạn nối, nên vẽ chấm để vẫn thấy.
  const pointRadius = values.map((v, i) => (v != null && values[i - 1] == null && values[i + 1] == null ? 2.5 : 0));
  const unit = isDomestic ? "triệu/lượng" : "USD/ounce";
  const format = isDomestic ? formatVnd : formatUsd;

  const config = {
    type: "line",
    data: {
      labels: raw.map((p) => hourLabel(p.x)),
      datasets: [{
        data: values,
        spanGaps: false,
        borderWidth: 2,
        tension: 0,
        pointRadius,
        pointHoverRadius: 4,
        pointBackgroundColor: colors.flat,
        borderColor: colors.flat,
        segment: {
          borderColor: (ctx) => colors[segmentDir(ctx.p0.parsed.y, ctx.p1.parsed.y)],
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => (ctx.parsed.y == null ? "Không có dữ liệu" : `${format(ctx.parsed.y)} ${unit}`),
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
          ticks: { color: ink, callback: (v) => format(v), font: { family: "Be Vietnam Pro" } },
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

function bindTargets() {
  const form = $("#targets");
  const error = $("#target-error");
  for (const key of Object.keys(PRODUCTS)) {
    const input = form.elements[key];
    if (targets[key] != null) input.value = formatVnd(targets[key]);
    input.addEventListener("input", () => {
      const text = input.value.trim();
      const value = parseTarget(text);
      if (text && value == null) {
        error.textContent = "Nhập giá bằng số, ví dụ 130,5.";
        return;
      }
      error.textContent = "";
      targets = { ...targets, [key]: value };
      saveTargets(targets);
      renderNotices();
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
  renderChart();
}

bindSegment("seg-series", (b) => { state.series = b.dataset.series; });
bindSegment("seg-range", (b) => { state.days = Number(b.dataset.days); });
bindTargets();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderChart);
load();
setInterval(load, REFRESH_MS);
