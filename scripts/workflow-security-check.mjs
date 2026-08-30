import assert from "node:assert/strict";
import fs from "node:fs";

const files = ["live-data-health.yml", "pages.yml", "update-signals.yml"];
const workflows = Object.fromEntries(files.map((file) => [file, fs.readFileSync(`.github/workflows/${file}`, "utf8")]));
const expectedPins = new Map([
  ["actions/checkout", ["11d5960a326750d5838078e36cf38b85af677262", "v4.4.0"]],
  ["actions/setup-node", ["49933ea5288caeca8642d1e84afbd3f7d6820020", "v4.4.0"]],
  ["actions/configure-pages", ["983d7736d9b0ae728b81ab479565c72886d7745b", "v5.0.0"]],
  ["actions/upload-pages-artifact", ["56afc609e74202658d3ffba0e8f6dda462b719fa", "v3.0.1"]],
  ["actions/deploy-pages", ["d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", "v4.0.5"]]
]);

const source = Object.values(workflows).join("\n");
const usesLines = source.match(/^\s*-\s+uses:/gm) || [];
const pins = [...source.matchAll(/^\s*-\s+uses:\s+([^@\s]+)@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)\s*$/gm)];
assert.equal(pins.length, usesLines.length, "every action must use a full SHA and version comment");
for (const [, action, sha, version] of pins) assert.deepEqual([sha, version], expectedPins.get(action), `${action} pin`);

assert(Object.values(workflows).every((workflow) => !/^permissions:/m.test(workflow)), "permissions must be job-scoped");
assert.equal((source.match(/^\s+contents:\s+write\s*$/gm) || []).length, 1, "only one job may write contents");
assert(/update:\s+permissions:\s+contents: write/.test(workflows["update-signals.yml"]), "only the publisher gets contents write");
assert(/deploy:\s+permissions:\s+contents: read\s+pages: write\s+id-token: write/.test(workflows["pages.yml"]), "Pages gets only required permissions");
assert.equal((source.match(/persist-credentials:\s+false/g) || []).length, 3, "all checkouts disable persisted credentials");
assert(workflows["update-signals.yml"].includes("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}") && workflows["update-signals.yml"].includes("http.https://github.com/.extraheader"), "push authenticates only in the publication step");
assert(workflows["live-data-health.yml"].includes("timeout-minutes: 5"));
assert(workflows["pages.yml"].includes("timeout-minutes: 10"));
assert(workflows["update-signals.yml"].includes("timeout-minutes: 15"));

console.log("workflow security check ok");
