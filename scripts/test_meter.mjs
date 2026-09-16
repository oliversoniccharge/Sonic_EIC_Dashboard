import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse } from "../dist/meter.mjs";
const channel = (suffix, values, interval = 30) => ({
  suffix,
  unit: "KWH",
  interval,
  days: { 20260831: { values, quality: values.map(() => "A") } },
});
test("E2 meter produces kWh and correct kW", () => {
  const a = analyse({ channels: [channel("E2", Array(48).fill(2))] });
  assert.equal(a.imported, 96);
  assert.equal(a.peak, 4);
  assert.equal(a.profile[0], 4);
  assert.equal(a.exported, null);
});
test("coincident peak sums registers rather than their noncoincident peaks", () => {
  const a = analyse({
    channels: [channel("E1", [5, 0]), channel("E2", [0, 5])],
  });
  assert.equal(a.peak, 10);
  assert.equal(a.imported, 10);
});
test("missing intervals stay missing and do not dilute profile", () => {
  const a = analyse({ channels: [channel("E1", [null, 0])] });
  assert.equal(a.missing, 1);
  assert.equal(a.profile[0], null);
  assert.equal(a.profile[1], 0);
});
test("different intervals combine on common site time", () => {
  const a = analyse({
    channels: [channel("E1", [1], 30), channel("E2", [1, 1], 15)],
  });
  assert.equal(a.peak, 6);
  assert.equal(a.imported, 3);
});
test("empty selection returns unknown, not fabricated zero", () => {
  const a = analyse(
    { channels: [channel("E1", [3])] },
    "2027-01-01",
    "2027-12-31",
  );
  assert.equal(a.imported, null);
  assert.equal(a.peak, null);
});
