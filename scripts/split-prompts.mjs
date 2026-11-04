#!/usr/bin/env node
/**
 * split-prompts.mjs
 *
 * Derives explicit `scenario` (string | null) and `ask` (string) fields from
 * the legacy monolithic `prompt` string of every question.
 *
 * The UI renders `scenario` as an optional setup paragraph and `ask` as the
 * actual question, so no runtime regex guessing is needed. `prompt` itself is
 * left untouched (it is still validated as the source of truth).
 *
 * Derivation rules (applied to the cleaned prompt: trailing " Options:" suffix
 * stripped and outer whitespace trimmed):
 *
 *   1. STRICT: the LAST question word (what/which/who/how/why/where/when) that
 *      a) begins a sentence (index 0, or preceded by [.?!] followed by
 *         whitespace), and
 *      b) occurs after 35% of the string length, and
 *      c) leaves a remainder of >= 20 chars that contains "?".
 *      Split there; scenario is everything before it.
 *
 *   2. LOOSE: if no strict candidate exists, the LAST question word that
 *      occurs after 42% of the string length with >= 90 chars of preceding
 *      text. The resulting ask gets its first letter capitalized.
 *
 *   3. Otherwise scenario is null and ask is the cleaned prompt.
 *
 * Idempotency: values already present and consistent with the prompt (i.e. a
 * manual correction, or output of a previous run) are preserved verbatim, so
 * re-running the script never clobbers hand-fixed splits.
 *
 * Usage:
 *   node scripts/split-prompts.mjs [path] [--report]
 *     path      defaults to src/data/questions.json (repo-root relative)
 *     --report  also print one line per question (scenario tail + ask)
 *
 * Output is 2-space indented JSON with a trailing newline.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..");

const OPTIONS_SUFFIX = /\s*Options:\s*$/i;
const QUESTION_WORD = /\b(what|which|who|how|why|where|when)\b/gi;
const STRICT_MIN_RATIO = 0.35;
const STRICT_MIN_REMAINDER = 20;
const LOOSE_MIN_RATIO = 0.42;
const LOOSE_MIN_PREFIX = 90;

/** Remove a trailing "Options:" label and surrounding whitespace. */
export function stripOptionsSuffix(prompt) {
  return prompt.replace(OPTIONS_SUFFIX, "").trim();
}

/** Collapse all whitespace runs to single spaces (comparison helper). */
export function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * True when the split reproduces the original prompt text.
 *
 * The loose fallback capitalizes the first letter of `ask` ("what ..." ->
 * "What ..."), so recombining scenario + ask can differ from the prompt by
 * exactly that one character's case. Everything else must match exactly, which
 * is what catches a genuinely wrong/manual edit.
 */
export function splitIsConsistent(cleanedPrompt, scenario, ask) {
  if (typeof ask !== "string" || ask.trim() === "") return false;
  const target = normalizeWhitespace(cleanedPrompt);
  const askNorm = normalizeWhitespace(ask);
  if (scenario === null) return askNorm === target;
  if (typeof scenario !== "string" || scenario.trim() === "") return false;
  const scenarioNorm = normalizeWhitespace(scenario);
  const joined = `${scenarioNorm} ${askNorm}`;
  if (joined === target) return true;
  // Allow only the ask's leading character to differ in case (rule 2/loose).
  const at = scenarioNorm.length + 1;
  return (
    joined.length === target.length &&
    joined.slice(0, at) === target.slice(0, at) &&
    joined.slice(at + 1) === target.slice(at + 1) &&
    joined[at] === askNorm[0] &&
    joined[at].toLowerCase() === target[at].toLowerCase()
  );
}

/** Rule 1: last sentence-initial question word after 35% with a real question tail. */
export function findStrictSplit(cleanedPrompt) {
  let best = null;
  for (const match of cleanedPrompt.matchAll(QUESTION_WORD)) {
    const index = match.index;
    if (index <= cleanedPrompt.length * STRICT_MIN_RATIO) continue;
    // (a) begins a sentence: either at index 0 (excluded by the ratio above)
    // or preceded by a sentence terminator plus whitespace.
    if (!/[.?!]\s+$/.test(cleanedPrompt.slice(0, index))) continue;
    // (c) remainder must be a real question.
    const ask = cleanedPrompt.slice(index).trim();
    if (ask.length < STRICT_MIN_REMAINDER || !ask.includes("?")) continue;
    best = { index, ask };
  }
  return best;
}

/** Rule 2: last question word after 42% with >= 90 chars of context. */
export function findLooseSplit(cleanedPrompt) {
  let best = null;
  for (const match of cleanedPrompt.matchAll(QUESTION_WORD)) {
    const index = match.index;
    if (index <= cleanedPrompt.length * LOOSE_MIN_RATIO) continue;
    if (index < LOOSE_MIN_PREFIX) continue;
    best = { index, ask: cleanedPrompt.slice(index).trim() };
  }
  if (!best) return null;
  return { index: best.index, ask: best.ask.charAt(0).toUpperCase() + best.ask.slice(1) };
}

/** Derive { scenario, ask } for one prompt string. */
export function deriveSplit(prompt) {
  const cleaned = stripOptionsSuffix(prompt);
  const strict = findStrictSplit(cleaned);
  if (strict && strict.index > 0) {
    const scenario = cleaned.slice(0, strict.index).trim();
    if (scenario !== "") return { scenario, ask: strict.ask };
  }
  const loose = findLooseSplit(cleaned);
  if (loose && loose.index > 0) {
    const scenario = cleaned.slice(0, loose.index).trim();
    if (scenario !== "") return { scenario, ask: loose.ask };
  }
  return { scenario: null, ask: cleaned };
}

/** Insert scenario/ask after "explanation", before sourceNote/answerStatus. */
export function withSplitFields(record) {
  const cleaned = stripOptionsSuffix(record.prompt);
  const hasExisting = Object.prototype.hasOwnProperty.call(record, "scenario") &&
    Object.prototype.hasOwnProperty.call(record, "ask");
  const keptExisting = hasExisting &&
    splitIsConsistent(cleaned, record.scenario, record.ask);
  const { scenario, ask } = keptExisting
    ? { scenario: record.scenario, ask: record.ask }
    : deriveSplit(record.prompt);

  const result = {};
  let inserted = false;
  const insert = () => {
    if (inserted) return;
    result.scenario = scenario;
    result.ask = ask;
    inserted = true;
  };
  for (const key of Object.keys(record)) {
    if (key === "scenario" || key === "ask") continue;
    if (key === "sourceNote" || key === "answerStatus") insert();
    result[key] = record[key];
    if (key === "explanation") insert();
  }
  insert();

  return { record: result, keptExisting };
}

/** Entry point. Returns stats; writes the file in place. */
export function splitQuestions(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error(`${filePath}: expected a JSON array`);
  let keptExisting = 0;
  const next = data.map((record) => {
    const { record: updated, keptExisting: kept } = withSplitFields(record);
    if (kept) keptExisting += 1;
    return updated;
  });
  const output = `${JSON.stringify(next, null, 2)}\n`;
  if (output !== raw) writeFileSync(filePath, output, "utf8");
  const withScenario = next.filter((q) => q.scenario !== null).length;
  return {
    total: next.length,
    withScenario,
    withoutScenario: next.length - withScenario,
    keptExisting,
    written: output !== raw,
    questions: next,
  };
}

function printReport(questions) {
  for (const q of questions) {
    const scenarioTail = q.scenario === null
      ? "(null)"
      : `…${q.scenario.length > 70 ? q.scenario.slice(-70) : q.scenario}`;
    const ask = q.ask.length > 90 ? `${q.ask.slice(0, 90)}…` : q.ask;
    console.log(`#${String(q.id).padStart(2)} | ${scenarioTail} | ASK: ${ask}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  const report = args.includes("--report");
  const explicitPath = args.find((a) => !a.startsWith("--"));
  const filePath = explicitPath
    ? (isAbsolute(explicitPath) ? explicitPath : resolve(process.cwd(), explicitPath))
    : resolve(REPO_ROOT, "src/data/questions.json");

  const stats = splitQuestions(filePath);

  console.log(`split-prompts: ${filePath}`);
  console.log(`  total:               ${stats.total}`);
  console.log(`  with scenario:       ${stats.withScenario}`);
  console.log(`  without scenario:    ${stats.withoutScenario}`);
  console.log(`  preserved existing:  ${stats.keptExisting}`);
  console.log(`  file ${stats.written ? "written" : "unchanged (already idempotent)"}`);
  if (report) printReport(stats.questions);
  return stats;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
