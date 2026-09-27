import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compareGithubSettings,
  loadExpectedSettings,
  rulesetPayload,
  verifyLiveGithubSettings,
} from "./github-settings.mjs";

const expected = await loadExpectedSettings();

function allowedMergeMethods() {
  const methods = [];
  if (expected.mergeMethods?.mergeCommit) methods.push("merge");
  if (expected.mergeMethods?.squash) methods.push("squash");
  if (expected.mergeMethods?.rebase) methods.push("rebase");
  return methods;
}

function actual() {
  return {
    repository: {
      id: 1350164837,
      node_id: "repository-node-id",
      default_branch: expected.defaultBranch,
      allow_merge_commit: expected.mergeMethods.mergeCommit,
      allow_squash_merge: expected.mergeMethods.squash,
      allow_rebase_merge: expected.mergeMethods.rebase,
      allow_auto_merge: expected.allowAutoMerge,
      delete_branch_on_merge: expected.deleteBranchOnMerge,
      updated_at: "2026-09-23T13:38:21Z",
    },
    rulesets: expected.rulesets.map((ruleset, index) => ({
      id: index + 100,
      node_id: "ruleset-node-" + index,
      name: ruleset.name,
      target: ruleset.target,
      source_type: "Repository",
      source: expected.repository,
      enforcement: ruleset.enforcement,
      bypass_actors: structuredClone(ruleset.bypassActors),
      current_user_can_bypass: "never",
      created_at: "2026-09-19T22:18:09Z",
      updated_at: "2026-09-20T20:58:45Z",
      conditions: {
        ref_name: {
          include: structuredClone(ruleset.include),
          exclude: structuredClone(ruleset.exclude),
        },
      },
      rules: ruleset.rules.map((type) => {
        if (type === "pull_request") {
          return {
            type,
            parameters: {
              allowed_merge_methods: allowedMergeMethods(),
              require_extra_approval_for_unattributed_changes:
                ruleset.requireExtraApprovalForUnattributedChanges === true,
              required_approving_review_count: 0,
              dismiss_stale_reviews_on_push: false,
              require_code_owner_review: false,
              require_last_push_approval: false,
              required_review_thread_resolution: false,
            },
          };
        }
        if (type === "required_status_checks") {
          return {
            type,
            parameters: {
              required_status_checks: expected.requiredStatusChecks.map((context) => ({ context })),
              strict_required_status_checks_policy: ruleset.requireBranchUpToDate === true,
              do_not_enforce_on_create: ruleset.doNotEnforceOnCreate === true,
            },
          };
        }
        return { type };
      }),
      _links: { self: { href: "https://api.github.com/example" } },
    })),
  };
}

function mainRuleset(state) {
  return state.rulesets.find((ruleset) => ruleset.name === "main-protection");
}

function tagRuleset(state) {
  return state.rulesets.find((ruleset) => ruleset.name === "release-tag-immutability");
}

function failuresFor(mutator) {
  const state = structuredClone(actual());
  mutator(state);
  return compareGithubSettings(expected, state).join("\n");
}

test("matching configuration passes", () => {
  assert.deepEqual(compareGithubSettings(expected, actual()), []);
});

test("merge commits unexpectedly enabled fail", () => {
  assert.match(failuresFor((state) => { state.repository.allow_merge_commit = true; }), /merge commits/);
});

test("squash merge unexpectedly disabled fails", () => {
  assert.match(failuresFor((state) => { state.repository.allow_squash_merge = false; }), /squash merges/);
});

test("rebase merge unexpectedly enabled fails", () => {
  assert.match(failuresFor((state) => { state.repository.allow_rebase_merge = true; }), /rebase merges/);
});

test("automatic branch deletion disabled fails", () => {
  assert.match(failuresFor((state) => { state.repository.allow_auto_merge = false; }), /auto-merge availability/);
  assert.match(failuresFor((state) => { state.repository.delete_branch_on_merge = false; }), /delete branch on merge/);
});

test("missing main ruleset fails", () => {
  assert.match(
    failuresFor((state) => { state.rulesets = state.rulesets.filter((r) => r.name !== "main-protection"); }),
    /missing ruleset: main-protection/,
  );
});

test("main ruleset target drift fails", () => {
  assert.match(failuresFor((state) => { mainRuleset(state).target = "tag"; }), /expected target branch/);
});

test("main ruleset enforcement drift fails", () => {
  assert.match(failuresFor((state) => { mainRuleset(state).enforcement = "disabled"; }), /expected enforcement active/);
});

test("main ruleset include drift fails", () => {
  assert.match(
    failuresFor((state) => { mainRuleset(state).conditions.ref_name.include = ["refs/heads/trunk"]; }),
    /expected ref includes refs\/heads\/main/,
  );
});

test("main ruleset exclusion drift fails", () => {
  assert.match(
    failuresFor((state) => { mainRuleset(state).conditions.ref_name.exclude = ["refs/heads/main"]; }),
    /expected ref excludes/,
  );
});

test("main ruleset bypass actor fails", () => {
  assert.match(
    failuresFor((state) => {
      mainRuleset(state).bypass_actors = [{ actor_id: 1, actor_type: "OrganizationAdmin", bypass_mode: "always" }];
    }),
    /bypass actors do not match/,
  );
});

test("force-push protection missing fails", () => {
  assert.match(
    failuresFor((state) => {
      const main = mainRuleset(state);
      main.rules = main.rules.filter((rule) => rule.type !== "non_fast_forward");
    }),
    /missing non_fast_forward rule/,
  );
});

test("delete protection missing fails", () => {
  assert.match(
    failuresFor((state) => {
      const main = mainRuleset(state);
      main.rules = main.rules.filter((rule) => rule.type !== "deletion");
    }),
    /missing deletion rule/,
  );
});

test("pull request protection missing fails", () => {
  assert.match(
    failuresFor((state) => {
      const main = mainRuleset(state);
      main.rules = main.rules.filter((rule) => rule.type !== "pull_request");
    }),
    /missing pull_request rule/,
  );
});

test("allowed merge method drift fails", () => {
  assert.match(
    failuresFor((state) => {
      mainRuleset(state).rules.find((rule) => rule.type === "pull_request")
        .parameters.allowed_merge_methods = ["merge"];
    }),
    /expected pull request merge methods squash/,
  );
});

test("unattributed-change approval weakening fails", () => {
  assert.match(
    failuresFor((state) => {
      mainRuleset(state).rules.find((rule) => rule.type === "pull_request")
        .parameters.require_extra_approval_for_unattributed_changes = false;
    }),
    /require extra approval for unattributed changes/,
  );
});

test("required CI check identity drift fails", () => {
  assert.match(
    failuresFor((state) => {
      mainRuleset(state).rules.find((rule) => rule.type === "required_status_checks")
        .parameters.required_status_checks = [{ context: "other" }];
    }),
    /required status checks do not match verify/,
  );
});

test("non-strict required status policy fails", () => {
  assert.match(
    failuresFor((state) => {
      mainRuleset(state).rules.find((rule) => rule.type === "required_status_checks")
        .parameters.strict_required_status_checks_policy = false;
    }),
    /must be current with main/,
  );
});

test("do_not_enforce_on_create drift fails", () => {
  assert.match(
    failuresFor((state) => {
      mainRuleset(state).rules.find((rule) => rule.type === "required_status_checks")
        .parameters.do_not_enforce_on_create = false;
    }),
    /do_not_enforce_on_create must be true/,
  );
});

test("missing release tag ruleset fails", () => {
  assert.match(
    failuresFor((state) => { state.rulesets = state.rulesets.filter((r) => r.name !== "release-tag-immutability"); }),
    /missing ruleset: release-tag-immutability/,
  );
});

test("release tag target drift fails", () => {
  assert.match(failuresFor((state) => { tagRuleset(state).target = "branch"; }), /expected target tag/);
});

test("release tag enforcement drift fails", () => {
  assert.match(failuresFor((state) => { tagRuleset(state).enforcement = "evaluate"; }), /expected enforcement active/);
});

test("release tag include drift fails", () => {
  assert.match(
    failuresFor((state) => { tagRuleset(state).conditions.ref_name.include = ["refs/tags/release-*"]; }),
    /expected ref includes refs\/tags\/v\*/,
  );
});

test("release tag bypass actor fails", () => {
  assert.match(
    failuresFor((state) => {
      tagRuleset(state).bypass_actors = [{ actor_id: 2, actor_type: "RepositoryRole", bypass_mode: "always" }];
    }),
    /bypass actors do not match/,
  );
});

test("tag update protection mismatch fails", () => {
  assert.match(
    failuresFor((state) => {
      const tags = tagRuleset(state);
      tags.rules = tags.rules.filter((rule) => rule.type !== "update");
    }),
    /missing update rule/,
  );
});

test("tag deletion protection mismatch fails", () => {
  assert.match(
    failuresFor((state) => {
      const tags = tagRuleset(state);
      tags.rules = tags.rules.filter((rule) => rule.type !== "deletion");
    }),
    /release-tag-immutability: missing deletion rule/,
  );
});

test("irrelevant provider metadata is ignored", () => {
  const state = actual();
  state.repository.id = 999999;
  state.repository.node_id = "changed-repository-node";
  state.repository.updated_at = "2099-01-01T00:00:00Z";
  for (const ruleset of state.rulesets) {
    ruleset.id += 1000;
    ruleset.node_id = "changed-" + ruleset.node_id;
    ruleset.created_at = "2099-01-01T00:00:00Z";
    ruleset.updated_at = "2099-01-02T00:00:00Z";
    ruleset._links = { self: { href: "https://api.github.com/changed" } };
  }
  assert.deepEqual(compareGithubSettings(expected, state), []);
});

test("inaccessible provider data is never treated as compliant", () => {
  assert.match(
    compareGithubSettings(expected, { repository: null, rulesets: null }).join("\n"),
    /inaccessible or missing/,
  );
});

test("main ruleset payload encodes the complete material branch policy", () => {
  const main = expected.rulesets.find((ruleset) => ruleset.name === "main-protection");
  const payload = rulesetPayload(expected, main);
  const pull = payload.rules.find((rule) => rule.type === "pull_request");
  const checks = payload.rules.find((rule) => rule.type === "required_status_checks");
  assert.deepEqual(payload.bypass_actors, []);
  assert.deepEqual(payload.conditions.ref_name, {
    include: ["refs/heads/main"],
    exclude: [],
  });
  assert.deepEqual(pull.parameters.allowed_merge_methods, ["squash"]);
  assert.equal(pull.parameters.require_extra_approval_for_unattributed_changes, true);
  assert.deepEqual(checks.parameters.required_status_checks, [{ context: "verify" }]);
  assert.equal(checks.parameters.strict_required_status_checks_policy, true);
  assert.equal(checks.parameters.do_not_enforce_on_create, true);
  assert.ok(payload.rules.some((rule) => rule.type === "deletion"));
  assert.ok(payload.rules.some((rule) => rule.type === "non_fast_forward"));
});

test("tag payload encodes exact scope, no bypass, update, and deletion restrictions", () => {
  const tags = expected.rulesets.find((ruleset) => ruleset.name === "release-tag-immutability");
  const payload = rulesetPayload(expected, tags);
  assert.deepEqual(payload.bypass_actors, []);
  assert.deepEqual(payload.conditions.ref_name, {
    include: ["refs/tags/v*"],
    exclude: [],
  });
  assert.deepEqual(payload.rules.map((rule) => rule.type).sort(), ["deletion", "update"]);
});

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const verifyScript = await readFile(
  new URL("./verify-github-settings.mjs", import.meta.url),
  "utf8",
);
const applyScript = await readFile(
  new URL("./apply-github-settings.mjs", import.meta.url),
  "utf8",
);

test("settings CLI exposes the normalized pure, verify, and apply contract", () => {
  const scripts = packageJson.scripts ?? {};
  assert.equal(scripts["test:github-settings"], "node --test scripts/github-settings-cases.mjs");
  assert.equal(scripts["verify:github-settings"], "node scripts/verify-github-settings.mjs");
  assert.equal(scripts["apply:github-settings"], "node scripts/apply-github-settings.mjs");
  assert.equal(scripts["check:github-settings"], undefined);
  assert.match(scripts.check, /npm run test:github-settings/);
  assert.doesNotMatch(scripts.check, /npm run (?:verify|apply|check):github-settings/);
});

test("live GitHub settings verification performs read-only provider requests", async () => {
  const state = actual();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    requests.push({ url, method });
    assert.equal(method, "GET");

    let value;
    if (url.endsWith("/repos/Wizard-Gang/SharkTank")) {
      value = state.repository;
    } else if (url.endsWith("/rulesets")) {
      value = state.rulesets.map((ruleset, index) => ({
        id: index + 1,
        name: ruleset.name,
      }));
    } else if (url.endsWith("/rulesets/1")) {
      value = state.rulesets[0];
    } else if (url.endsWith("/rulesets/2")) {
      value = state.rulesets[1];
    } else {
      throw new Error("unexpected provider read: " + url);
    }

    return {
      status: 200,
      ok: true,
      json: async () => structuredClone(value),
      text: async () => JSON.stringify(value),
    };
  };

  const { failures } = await verifyLiveGithubSettings(expected, {
    token: "test-token",
    fetchImpl,
  });
  assert.deepEqual(failures, []);
  assert.ok(requests.length >= 4);
});

test("apply is the explicit mutation path and re-reads provider state after mutation", () => {
  assert.match(verifyScript, /verifyLiveGithubSettings/);
  assert.doesNotMatch(verifyScript, /method:\s*["'](?:PATCH|PUT|POST|DELETE)["']/);

  const mutationIndexes = [
    applyScript.lastIndexOf('method: "PATCH"'),
    applyScript.lastIndexOf('method: "PUT"'),
    applyScript.lastIndexOf('method: "POST"'),
  ];
  assert.ok(mutationIndexes.every((index) => index >= 0));
  const freshReadIndex = applyScript.lastIndexOf("await fetchLiveGithubSettings");
  assert.ok(freshReadIndex > Math.max(...mutationIndexes));
});
