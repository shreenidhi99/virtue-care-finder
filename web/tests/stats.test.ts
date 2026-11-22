import assert from "node:assert/strict";
import { test } from "node:test";
import { districtAt, type DistrictGeo } from "../lib/planner/geo.ts";
import { median, pctRank, pearson, quantile } from "../lib/planner/stats.ts";

test("matches pandas quantile / rank(pct=True) / corr", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.98), 3.94);
  assert.equal(median([3, null, 1, 2]), 2);
  assert.deepEqual(pctRank([10, 20, 20, null, 5]), [0.5, 0.875, 0.875, null, 0.25]);
  assert.ok(Math.abs(pearson([1, 2, 3, null], [2, 4, 7, 1])! - 0.9933992677987828) < 1e-12);
});

test("districtAt finds the polygon under a pin, respecting holes", () => {
  const geo: DistrictGeo = { type: "FeatureCollection", features: [{
    type: "Feature", id: "S|A", properties: { district: "A", state: "S", nfhs_state: "S", nfhs_district: "A" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] },
  }] };
  assert.equal(districtAt(geo, 2, 2)?.id, "S|A");
  assert.equal(districtAt(geo, 5, 5), null);
  assert.equal(districtAt(geo, 20, 20), null);
});
