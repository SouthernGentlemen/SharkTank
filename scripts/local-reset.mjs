import { lstatSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

const RESET_DEFINITIONS = Object.freeze({
  dist: Object.freeze({ relativePath: "dist", classification: "disposable" }),
  wrangler: Object.freeze({ relativePath: ".wrangler", classification: "disposable" }),
});

export function parseLocalResetArgs(args) {
  if (!Array.isArray(args)) throw new TypeError("local reset arguments must be an array");
  if (args.length > 0) {
    throw new Error(`unsupported local reset option: ${JSON.stringify(args[0])}`);
  }
  return {};
}

function requireAbsoluteNormalizedPath(label, value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty, well-formed path`);
  }
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute`);
  if (normalize(value) !== value) throw new Error(`${label} must already be normalized`);
  return value;
}

function isContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

function lstatIfPresent(path, lstatFn) {
  try {
    return lstatFn(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertNoSymlinkEscape(projectRoot, targetPath, { lstatFn, realpathFn }) {
  const canonicalRoot = realpathFn(projectRoot);
  const parts = relative(projectRoot, targetPath).split(sep).filter(Boolean);
  let current = projectRoot;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatIfPresent(current, lstatFn);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`reset target crosses a symbolic link: ${current}`);
    }

    const canonicalCurrent = realpathFn(current);
    const rel = relative(canonicalRoot, canonicalCurrent);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`reset target resolves outside the checkout: ${targetPath}`);
    }
  }
}

export function validateResetTarget(
  { projectRoot, key, targetPath },
  { lstatFn = lstatSync, realpathFn = realpathSync } = {},
) {
  const root = requireAbsoluteNormalizedPath("project root", projectRoot);
  const target = requireAbsoluteNormalizedPath("reset target", targetPath);
  const definition = RESET_DEFINITIONS[key];
  if (!definition) {
    throw new Error(`unknown reset target classification: ${JSON.stringify(key)}`);
  }

  const expected = join(root, definition.relativePath);
  if (target !== expected) {
    throw new Error(`reset target is not the canonical ${key} path for this checkout`);
  }
  if (!isContained(root, target)) {
    throw new Error("reset target must stay inside the checkout");
  }

  assertNoSymlinkEscape(root, target, { lstatFn, realpathFn });
  return { key, path: target, classification: definition.classification };
}

export function createLocalResetPlan(projectRoot) {
  const root = requireAbsoluteNormalizedPath("project root", resolve(projectRoot));
  const keys = ["dist", "wrangler"];

  return {
    projectRoot: root,
    targets: keys.map((key) => ({
      key,
      path: join(root, RESET_DEFINITIONS[key].relativePath),
      classification: RESET_DEFINITIONS[key].classification,
    })),
  };
}

export function executeLocalResetPlan(
  plan,
  { lstatFn = lstatSync, realpathFn = realpathSync, rmFn = rmSync } = {},
) {
  if (!plan || !Array.isArray(plan.targets)) throw new Error("invalid local reset plan");

  const validated = plan.targets.map((target) => {
    const expected = validateResetTarget(
      {
        projectRoot: plan.projectRoot,
        key: target?.key,
        targetPath: target?.path,
      },
      { lstatFn, realpathFn },
    );
    if (target?.classification !== expected.classification) {
      throw new Error(`reset classification mismatch for ${target?.key ?? "unknown"}`);
    }
    return expected;
  });

  for (const target of validated) {
    rmFn(target.path, { recursive: true, force: true });
  }
  return validated;
}
