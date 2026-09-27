import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createLocalResetPlan,
  executeLocalResetPlan,
  parseLocalResetArgs,
  validateResetTarget,
} from "./local-reset.mjs";

function fixture() {
  const root = resolve(mkdtempSync(join(tmpdir(), "sharktank-reset-")));
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, ".wrangler"), { recursive: true });
  writeFileSync(join(root, "dist", "bundle.js"), "generated");
  writeFileSync(join(root, ".wrangler", "cache"), "generated");
  return root;
}

test("default reset removes only disposable generated paths", () => {
  const root = fixture();
  const plan = createLocalResetPlan(root);

  assert.deepEqual(
    plan.targets.map(({ key, classification }) => [key, classification]),
    [["dist", "disposable"], ["wrangler", "disposable"]],
  );

  executeLocalResetPlan(plan);

  assert.equal(existsSync(join(root, "dist")), false);
  assert.equal(existsSync(join(root, ".wrangler")), false);
});

test("local reset accepts no destructive path options", () => {
  assert.deepEqual(parseLocalResetArgs([]), {});

  for (const args of [[""], ["../data"], ["/tmp/data"], ["--reset-path=/tmp/data"], ["--reset-data"]]) {
    assert.throws(() => parseLocalResetArgs(args), /unsupported local reset option/);
  }
});

test("unsafe, escaped, ambiguous, and malformed reset paths are refused", () => {
  const root = fixture();
  const canonical = join(root, "dist");
  const candidates = [
    dirname(root),
    root,
    join(root, "dist-sibling"),
    resolve(tmpdir(), "arbitrary-absolute-reset"),
    "",
    "dist",
    `${canonical}\0escape`,
  ];

  for (const targetPath of candidates) {
    assert.throws(
      () => validateResetTarget({ projectRoot: root, key: "dist", targetPath }),
      /reset target|path|checkout|canonical/,
    );
  }
});

test("a symlinked canonical reset target cannot redirect outside the checkout", () => {
  const root = fixture();
  const target = join(root, "dist");
  const outside = resolve(mkdtempSync(join(tmpdir(), "sharktank-reset-link-target-")));
  writeFileSync(join(outside, "keep.txt"), "outside");
  rmSync(target, { recursive: true, force: true });
  symlinkSync(outside, target, "dir");

  const mutations = [];
  assert.throws(
    () => executeLocalResetPlan(createLocalResetPlan(root), {
      rmFn: (...args) => mutations.push(args),
    }),
    /symbolic link/,
  );
  assert.deepEqual(mutations, []);
  assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "outside");
});

test("all reset targets are validated before the first destructive mutation", () => {
  const root = fixture();
  const plan = createLocalResetPlan(root);
  plan.targets[1] = { ...plan.targets[1], path: join(dirname(root), "outside-data") };

  const mutations = [];
  assert.throws(
    () => executeLocalResetPlan(plan, { rmFn: (...args) => mutations.push(args) }),
    /canonical wrangler path/,
  );
  assert.deepEqual(mutations, []);
  assert.equal(existsSync(join(root, "dist", "bundle.js")), true);
});

test("reset remains ordered after ST-069 ownership cleanup and fail-closed port checks", () => {
  const source = readFileSync(new URL("./local.mjs", import.meta.url), "utf8");
  const resetCall = source.indexOf("executeLocalResetPlan(resetPlan)");
  assert.ok(resetCall > 0);
  assert.ok(source.indexOf("await stopRecordedWrangler()") < resetCall);
  assert.ok(source.indexOf("existsSync(WRANGLER_OWNER_FILE)") < resetCall);
  assert.ok(source.indexOf("await requirePortsFree") < resetCall);
});
