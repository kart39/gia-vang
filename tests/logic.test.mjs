import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../assets/logic.js";

const HOUR = 3600_000;
const rec = (t, fields) => ({ t, sjc_buy: null, sjc_sell: null, ring_buy: null, ring_sell: null, xau_usd: null, ...fields });

test("toLuong / toChi convert from thousand VND per chỉ", () => {
  assert.equal(toLuong(13500), 135);
  assert.equal(toChi(13250), 13.25);
  assert.equal(toLuong(null), null);
  assert.equal(toChi(null), null);
});

test("latest returns null for empty history and last record otherwise", () => {
  const a = rec("2026-11-23T08:05:00Z", {});
  const b = rec("2026-11-23T09:05:00Z", {});
  assert.equal(latest([]), null);
  assert.equal(latest([a, b]), b);
});

test("change24h compares with the record nearest to 24h earlier", () => {
  const history = [
    rec("2026-11-22T09:05:00Z", { sjc_sell: 13400 }),
    rec("2026-11-22T10:05:00Z", { sjc_sell: 13450 }),
    rec("2026-11-23T09:05:00Z", { sjc_sell: 13500 }),
  ];
  assert.deepEqual(change24h(history, "sjc_sell"), { diff: 100, dir: "up" });
});

test("change24h is null when nothing lies within 90 minutes of the 24h mark", () => {
  const history = [
    rec("2026-11-22T06:00:00Z", { sjc_sell: 13400 }),
    rec("2026-11-23T09:05:00Z", { sjc_sell: 13500 }),
  ];
  assert.equal(change24h(history, "sjc_sell"), null);
});

test("change24h reports down and flat", () => {
  const down = [rec("2026-11-22T09:00:00Z", { xau_usd: 3600 }), rec("2026-11-23T09:00:00Z", { xau_usd: 3590.5 })];
  assert.deepEqual(change24h(down, "xau_usd"), { diff: -9.5, dir: "down" });
  const flat = [rec("2026-11-22T09:00:00Z", { ring_sell: 13250 }), rec("2026-11-23T09:00:00Z", { ring_sell: 13250 })];
  assert.deepEqual(change24h(flat, "ring_sell"), { diff: 0, dir: "flat" });
});

test("isStale flags data older than 3 hours", () => {
  const now = Date.parse("2026-11-23T08:30:00Z");
  assert.equal(isStale("2026-11-23T05:00:00Z", now), true);
  assert.equal(isStale("2026-11-23T07:00:00Z", now), false);
});

test("hourlySeries leaves missing hours as null gaps", () => {
  const since = Date.parse("2026-11-23T07:00:00Z");
  const until = Date.parse("2026-11-23T09:30:00Z");
  const history = [
    rec("2026-11-23T07:05:00Z", { ring_sell: 13200 }),
    rec("2026-11-23T09:05:00Z", { ring_sell: 13250 }),
  ];
  const series = hourlySeries(history, "ring_sell", since, until);
  assert.deepEqual(series, [
    { x: since, y: 13200 },
    { x: since + HOUR, y: null },
    { x: since + 2 * HOUR, y: 13250 },
  ]);
});

test("hourlySeries keeps the last record when two fall in the same hour", () => {
  const since = Date.parse("2026-11-23T09:00:00Z");
  const history = [
    rec("2026-11-23T09:05:00Z", { sjc_sell: 13500 }),
    rec("2026-11-23T09:40:00Z", { sjc_sell: 13550 }),
  ];
  assert.deepEqual(hourlySeries(history, "sjc_sell", since, since + 30 * 60_000), [{ x: since, y: 13550 }]);
});

test("segmentDir", () => {
  assert.equal(segmentDir(1, 2), "up");
  assert.equal(segmentDir(2, 1), "down");
  assert.equal(segmentDir(2, 2), "flat");
});

test("parseTarget accepts Vietnamese comma and dot decimals", () => {
  assert.equal(parseTarget("132,5"), 132.5);
  assert.equal(parseTarget("132.5"), 132.5);
  assert.equal(parseTarget(" 130 "), 130);
  assert.equal(parseTarget(" "), null);
  assert.equal(parseTarget("abc"), null);
  assert.equal(parseTarget("-5"), null);
});

test("targetHit compares sell price in triệu/lượng with the target", () => {
  assert.equal(targetHit(13250, 132.5), true);
  assert.equal(targetHit(13260, 132.5), false);
  assert.equal(targetHit(null, 132.5), false);
  assert.equal(targetHit(13250, null), false);
});

test("latestValue skips records where that field failed", () => {
  const history = [
    rec("2026-11-23T07:05:00Z", { ring_sell: 13250, xau_usd: 3600 }),
    rec("2026-11-23T08:05:00Z", { ring_sell: null, xau_usd: 3610 }),
  ];
  assert.deepEqual(latestValue(history, "ring_sell"), { value: 13250, t: "2026-11-23T07:05:00Z" });
  assert.deepEqual(latestValue(history, "xau_usd"), { value: 3610, t: "2026-11-23T08:05:00Z" });
  assert.equal(latestValue(history, "sjc_sell"), null);
  assert.equal(latestValue([], "sjc_sell"), null);
});

test("change24h uses the latest non-null value of the field", () => {
  const history = [
    rec("2026-11-22T08:05:00Z", { ring_sell: 13200 }),
    rec("2026-11-23T08:05:00Z", { ring_sell: 13250 }),
    rec("2026-11-23T09:05:00Z", { ring_sell: null, xau_usd: 3600 }),
  ];
  assert.deepEqual(change24h(history, "ring_sell"), { diff: 50, dir: "up" });
});

test("targetLooksWrong flags targets far from the current sell price", () => {
  assert.equal(targetLooksWrong(13.2, 132.5), true); // nhập theo triệu/chỉ
  assert.equal(targetLooksWrong(13250, 132.5), true); // nhập theo đơn vị gốc của PNJ
  assert.equal(targetLooksWrong(128, 132.5), false);
  assert.equal(targetLooksWrong(null, 132.5), false);
  assert.equal(targetLooksWrong(128, null), false);
});

test("cheapest picks the lowest sell price and ignores missing shops", () => {
  assert.deepEqual(cheapest([{ shop: "PNJ", value: 13250 }, { shop: "BTMC", value: 13450 }]), { shop: "PNJ", value: 13250 });
  assert.deepEqual(cheapest([{ shop: "PNJ", value: null }, { shop: "BTMC", value: 13450 }]), { shop: "BTMC", value: 13450 });
  assert.equal(cheapest([{ shop: "PNJ", value: null }]), null);
  assert.equal(cheapest([]), null);
});
