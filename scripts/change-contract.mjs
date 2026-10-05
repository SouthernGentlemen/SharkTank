export const CONTROLLED_TYPES = Object.freeze([
  "INIT", "FEAT", "FIX", "SEC", "API", "A11Y", "I18N", "AI", "DB",
  "OPS", "TEST", "DOCS", "REFACTOR", "PERF", "BUILD", "REVERT", "CHORE",
]);

export const LEGACY_TYPE_EXCEPTIONS = Object.freeze(new Map([
  ["ST-008", "GOV"],
  ["ST-012", "GOV"],
  ["ST-013", "GOV"],
  ["ST-015", "GOV"],
  ["ST-020", "UX"],
  ["ST-022", "GOV"],
  ["ST-023", "UX"],
  ["ST-027", "GOV"],
]));

export const IMMUTABLE_HISTORY_BODY_EXCEPTIONS = Object.freeze(new Map([
  ["79c1054361d8229d70da8a106809fc70d1cb5c59", Object.freeze({
    id: "ST-116",
    subject: "[ST-116] [FEAT] Rebuild desktop controls for full-3D play",
    missingHeadings: Object.freeze(["Reason", "Impact", "Risk", "Controls", "Evidence"]),
    missingProvenance: true,
    reason: "The protected ST-116 PR head carried the complete structured body, but its published GitHub squash merge body was shortened after exact-head CI. Published main is immutable, so only that exact commit and known body defect are accepted.",
  })],
  ["f0a432effd74b2959a6ff0de3d6bb751e95a9e27", Object.freeze({
    id: "ST-125",
    subject: "[ST-125] [FEAT] Build spatial underwater game audio (#105)",
    missingHeadings: Object.freeze(["Reason", "Impact", "Risk", "Controls", "Evidence"]),
    missingProvenance: true,
    reason: "The protected ST-125 PR head carried the complete structured body and passed exact-head CI, but the published GitHub squash merge body was shortened and omitted required history metadata. Published main is immutable, so only this exact commit and known body defect are accepted.",
  })],
]));

// ST-225 reassigned the then-open ST-150..ST-220 queue entries to ST-226..ST-296
// when the owner moved the Worker cut-over ahead of them. Only that published,
// plan-only maintenance commit authorizes this one historical sequence gap.
const REASSIGNED_QUEUE_MAINTENANCE = Object.freeze({
  sha: "e684fc3dc1f8049556474407420ed0b9ba6b9c43",
  subject: "[ST-225] [DOCS] Move the sharktank cut-over after the lean refactor",
  first: 150,
  last: 220,
});

const controlledTypeSet = new Set(CONTROLLED_TYPES);
const titlePattern = /^\[(ST-(\d{3}))\] \[([A-Z][A-Z0-9-]*)\] ([^\r\n]+)$/;
const branchPattern = /^st-(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const dependabotSubjectPattern = /^build\(deps(?:-dev)?\): [Bb]ump .+ from .+ to .+$/;
const dependabotEmailPattern = /^\d+\+dependabot\[bot\]@users\.noreply\.github\.com$/;
const requiredHeadings = ["Change", "Reason", "Impact", "Risk", "Controls", "Validation", "Evidence"];

export function parseControlledTitle(subject) {
  const match = subject.match(titlePattern);
  if (!match) return null;
  return {
    id: match[1],
    number: Number(match[2]),
    type: match[3],
    summary: match[4],
  };
}

export function parseControlledBranch(branch) {
  const match = branch.match(branchPattern);
  if (!match) return null;
  return {
    id: `ST-${match[1]}`,
    number: Number(match[1]),
  };
}

export function isVerifiedDependabotCommit({ authorName, authorEmail, subject }) {
  return authorName === "dependabot[bot]"
    && dependabotEmailPattern.test(authorEmail)
    && dependabotSubjectPattern.test(subject);
}

function validateCurrentType(id, type, failures, label) {
  if (!controlledTypeSet.has(type)) {
    failures.push(`${label}: ${id} uses unsupported type ${type}`);
  }
}

function validateHistoricalType(id, type, failures, label) {
  if (controlledTypeSet.has(type)) return;
  if (LEGACY_TYPE_EXCEPTIONS.get(id) === type) return;
  failures.push(`${label}: ${id} uses unsupported type ${type}`);
}

function structuredBodyDefect(body) {
  return {
    missingHeadings: requiredHeadings.filter(
      (heading) => !new RegExp(`(?:^|\\n)${heading}:\\n`).test(body),
    ),
    missingProvenance: !/(?:^|\n)(?:Notes|Source):(?:\n| )/.test(body),
  };
}

function matchesImmutableHistoryBodyException(record, parsed, defect) {
  const exception = IMMUTABLE_HISTORY_BODY_EXCEPTIONS.get(record.sha);
  if (!exception || parsed.id !== exception.id || record.subject !== exception.subject) return false;
  if (defect.missingProvenance !== exception.missingProvenance) return false;
  if (defect.missingHeadings.length !== exception.missingHeadings.length) return false;
  return defect.missingHeadings.every((heading, index) => heading === exception.missingHeadings[index]);
}

export function validateHistoryRecords(records) {
  const failures = [];
  let expectedNumber = 1;
  let controlledCount = 0;
  const earlyMaintenance = new Set();
  let queueReassignmentSeen = false;

  for (const record of records) {
    if (isVerifiedDependabotCommit(record)) continue;

    const parsed = parseControlledTitle(record.subject);
    const label = record.sha ? record.sha.slice(0, 12) : "history";

    if (!parsed) {
      failures.push(`${label}: invalid controlled-change subject: ${record.subject}`);
      continue;
    }

    const maintenance = /^Portfolio-Plan-Maintenance: true$/m.test(record.body);
    if (record.sha === REASSIGNED_QUEUE_MAINTENANCE.sha
      && record.subject === REASSIGNED_QUEUE_MAINTENANCE.subject
      && maintenance) queueReassignmentSeen = true;
    while (earlyMaintenance.has(expectedNumber)
      || (queueReassignmentSeen
        && expectedNumber >= REASSIGNED_QUEUE_MAINTENANCE.first
        && expectedNumber <= REASSIGNED_QUEUE_MAINTENANCE.last)) expectedNumber += 1;
    if (maintenance && parsed.number > expectedNumber) {
      earlyMaintenance.add(parsed.number);
    } else {
      const expectedId = `ST-${String(expectedNumber).padStart(3, "0")}`;
      if (parsed.id !== expectedId) failures.push(`${label}: expected ${expectedId}, found ${parsed.id}`);
      else expectedNumber += 1;
    }
    controlledCount += 1;

    validateHistoricalType(parsed.id, parsed.type, failures, label);

    const defect = structuredBodyDefect(record.body);
    if (!matchesImmutableHistoryBodyException(record, parsed, defect)) {
      for (const heading of defect.missingHeadings) {
        failures.push(`${label}: missing ${heading}: heading`);
      }
      if (defect.missingProvenance) {
        failures.push(`${label}: missing Notes: or Source: provenance field`);
      }
    }
  }

  if (controlledCount === 0) failures.push("no controlled ST changes found");

  return {
    failures,
    controlledCount,
    lastId: controlledCount === 0
      ? null
      : `ST-${String(expectedNumber - 1).padStart(3, "0")}`,
  };
}

export function validatePullRequestContext(context) {
  const failures = [];

  if (!context.eventName) {
    return { failures, kind: "local" };
  }

  if (context.eventName === "push") {
    return { failures, kind: "push" };
  }

  if (context.eventName !== "pull_request") {
    return {
      failures: [`unsupported GitHub event: ${context.eventName || "(empty)"}`],
      kind: "unsupported",
    };
  }

  const title = parseControlledTitle(context.title);
  const branch = parseControlledBranch(context.branch);
  const commit = parseControlledTitle(context.commitSubject);

  if (!title) {
    failures.push(`pull request title must match [ST-NNN] [TYPE] Imperative summary: ${context.title}`);
  } else {
    validateCurrentType(title.id, title.type, failures, "pull request title");
  }

  if (!branch) {
    failures.push(`branch must match st-NNN-imperative-summary: ${context.branch}`);
  }

  if (!commit) {
    failures.push(`head commit must use a controlled title: ${context.commitSubject}`);
  } else {
    validateCurrentType(commit.id, commit.type, failures, "head commit");
  }

  if (title && branch && title.id !== branch.id) {
    failures.push(`pull request/branch ID mismatch: ${title.id} vs ${branch.id}`);
  }
  if (title && commit && title.id !== commit.id) {
    failures.push(`pull request/head commit ID mismatch: ${title.id} vs ${commit.id}`);
  }
  if (title && commit && title.type !== commit.type) {
    failures.push(`pull request/head commit type mismatch: ${title.type} vs ${commit.type}`);
  }

  return { failures, kind: "controlled" };
}
