#!/usr/bin/env node
/**
 * validate-questions.mjs
 *
 * Dependency-free CI gate for the question bank. Validates the structural
 * invariants of src/data/questions.json (or a path passed as argv[2], which is
 * used to prove the gate fails on broken data).
 *
 * Usage:
 *   node scripts/validate-questions.mjs [path]
 *
 * Exit code: 0 when every check passes, 1 when any problem is found (also on
 * unreadable/invalid JSON or a non-array top level).
 *
 * Cross-field consistency (the important one):
 *   cleaned = prompt with the trailing " Options:" label stripped and
 *   whitespace normalized. Then:
 *     scenario !== null -> normalize(scenario + " " + ask) === cleaned
 *     scenario === null -> normalize(ask) === cleaned
 *   Exception, by design of scripts/split-prompts.mjs rule 2: the loose split
 *   capitalizes the ask's first letter, so that single character may differ
 *   from the prompt in case. Any other difference is a real split bug.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const EXPECTED_COUNT = 80;
const OPTIONS_SUFFIX = /\s*Options:\s*$/i;
const VALID_ANSWER_STATUSES = new Set(["conflict", "inferred", "corrected", "ambiguous"]);

const problems = [];
const fail = (message) => problems.push(message);

/** Collapse whitespace runs to single spaces. */
const normalize = (value) => value.replace(/\s+/g, " ").trim();

/** Remove the trailing " Options:" label and outer whitespace. */
const stripOptionsSuffix = (prompt) => prompt.replace(OPTIONS_SUFFIX, "").trim();

/**
 * True when scenario+ask recombine into the cleaned prompt. The ask's leading
 * character may differ in case only (loose-split capitalization rule).
 */
function splitMatchesPrompt(cleanedPrompt, scenario, ask) {
  const target = normalize(cleanedPrompt);
  const askNorm = normalize(ask);
  if (scenario === null) return askNorm === target;
  const scenarioNorm = normalize(scenario);
  const joined = `${scenarioNorm} ${askNorm}`;
  if (joined === target) return true;
  const at = scenarioNorm.length + 1;
  return (
    joined.length === target.length &&
    joined.slice(0, at) === target.slice(0, at) &&
    joined.slice(at + 1) === target.slice(at + 1) &&
    joined[at] === askNorm[0] &&
    joined[at].toLowerCase() === target[at].toLowerCase()
  );
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

const label = (index, question) =>
  question && Number.isInteger(question.id) ? `record #${question.id}` : `record [${index}]`;

function validate(data) {
  if (!Array.isArray(data)) {
    fail(`top level is ${typeof data}, expected an array`);
    return;
  }
  if (data.length !== EXPECTED_COUNT) {
    fail(`expected exactly ${EXPECTED_COUNT} questions, found ${data.length}`);
  }

  const seenIds = new Map();
  const seenPrompts = new Map();

  data.forEach((question, index) => {
    const at = label(index, question);
    if (question === null || typeof question !== "object" || Array.isArray(question)) {
      fail(`${at}: expected an object`);
      return;
    }

    // id
    if (!Number.isInteger(question.id)) {
      fail(`${at}: "id" must be an integer, got ${JSON.stringify(question.id)}`);
    } else if (seenIds.has(question.id)) {
      fail(`${at}: duplicate id ${question.id} (also record [${seenIds.get(question.id)}])`);
    } else {
      seenIds.set(question.id, index);
    }

    // prompt
    if (!isNonEmptyString(question.prompt)) {
      fail(`${at}: "prompt" must be a non-empty string`);
    } else {
      const prompt = question.prompt.trimEnd();
      if (!(prompt.endsWith("?") || / Options:$/i.test(prompt))) {
        fail(`${at}: "prompt" must end with "?" or " Options:"`);
      }
      if (seenPrompts.has(question.prompt)) {
        fail(`${at}: duplicate prompt text (also record [${seenPrompts.get(question.prompt)}])`);
      } else {
        seenPrompts.set(question.prompt, index);
      }
    }

    // options
    if (!Array.isArray(question.options)) {
      fail(`${at}: "options" must be an array`);
    } else {
      if (question.options.length !== 4) {
        fail(`${at}: expected exactly 4 options, found ${question.options.length}`);
      }
      const expectedIds = ["A", "B", "C", "D"];
      const texts = [];
      question.options.forEach((option, optionIndex) => {
        const expectedId = expectedIds[optionIndex];
        if (option === null || typeof option !== "object" || Array.isArray(option)) {
          fail(`${at}: option ${expectedId} must be an object`);
          return;
        }
        if (option.id !== expectedId) {
          fail(
            `${at}: option at position ${optionIndex} must have id "${expectedId}", got ${JSON.stringify(option.id)}`,
          );
        }
        if (!isNonEmptyString(option.text)) {
          fail(`${at}: option ${expectedId} must have non-empty text`);
        } else {
          const text = option.text.trim();
          if (texts.includes(text)) {
            fail(`${at}: duplicate option text ${JSON.stringify(text)}`);
          } else {
            texts.push(text);
          }
        }
      });
    }

    // answer
    if (typeof question.answer !== "string" || !["A", "B", "C", "D"].includes(question.answer)) {
      fail(`${at}: "answer" must be one of "A", "B", "C", "D", got ${JSON.stringify(question.answer)}`);
    }

    // explanation
    if (typeof question.explanation !== "string") {
      fail(`${at}: "explanation" must be a string (empty allowed)`);
    }

    // scenario / ask
    const hasScenario = Object.prototype.hasOwnProperty.call(question, "scenario");
    const hasAsk = Object.prototype.hasOwnProperty.call(question, "ask");
    if (!hasScenario) fail(`${at}: missing "scenario" field (use null when there is no setup)`);
    if (!hasAsk) fail(`${at}: missing "ask" field`);
    if (hasScenario) {
      const scenario = question.scenario;
      if (scenario !== null && !isNonEmptyString(scenario)) {
        fail(`${at}: "scenario" must be null or a non-empty string`);
      }
    }
    if (hasAsk && !isNonEmptyString(question.ask)) {
      fail(`${at}: "ask" must be a non-empty string`);
    }

    // scenario/ask must reconstruct the prompt
    if (
      isNonEmptyString(question.prompt) &&
      hasScenario &&
      hasAsk &&
      (question.scenario === null || isNonEmptyString(question.scenario)) &&
      isNonEmptyString(question.ask)
    ) {
      const cleaned = stripOptionsSuffix(question.prompt);
      if (!splitMatchesPrompt(cleaned, question.scenario, question.ask)) {
        fail(
          `${at}: scenario+ask does not reconstruct the prompt (expected ${JSON.stringify(
            normalize(cleaned).slice(0, 80),
          )}…)`,
        );
      }
    }

    // answerStatus / sourceNote
    const hasStatus = Object.prototype.hasOwnProperty.call(question, "answerStatus");
    if (hasStatus && !VALID_ANSWER_STATUSES.has(question.answerStatus)) {
      fail(
        `${at}: "answerStatus" must be one of "conflict", "inferred", "corrected", "ambiguous", got ${JSON.stringify(question.answerStatus)}`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(question, "sourceNote")) {
      if (!isNonEmptyString(question.sourceNote)) {
        fail(`${at}: "sourceNote", when present, must be a non-empty string`);
      }
      if (!hasStatus) {
        fail(`${at}: "sourceNote" requires an accompanying "answerStatus"`);
      }
    }
  });
}

function printSummary(data, filePath) {
  const questions = Array.isArray(data) ? data : [];
  const withScenario = questions.filter(
    (question) => question && question.scenario !== null && question.scenario !== undefined,
  ).length;
  console.log(`validate-questions: ${filePath}`);
  console.log(`  total:               ${questions.length}`);
  console.log(`  with scenario:       ${withScenario}`);
  console.log(`  without scenario:    ${questions.length - withScenario}`);
  console.log(
    `  missing explanation: ${questions.filter(
      (question) => !question || typeof question.explanation !== "string" || question.explanation.trim() === "",
    ).length}`,
  );
}

function main(argv) {
  const explicitPath = argv[2];
  const filePath = explicitPath
    ? (isAbsolute(explicitPath) ? explicitPath : resolve(process.cwd(), explicitPath))
    : resolve(REPO_ROOT, "src/data/questions.json");

  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`validate-questions: cannot read/parse ${filePath}: ${error.message}`);
    console.error("FAIL: 1 problem(s) found");
    process.exitCode = 1;
    return;
  }

  validate(data);

  for (const message of problems) console.log(`  problem: ${message}`);
  printSummary(data, filePath);

  if (problems.length > 0) {
    console.log(`FAIL: ${problems.length} problem(s) found`);
    process.exitCode = 1;
  } else {
    console.log("OK: all question-bank checks passed");
    process.exitCode = 0;
  }
}

main(process.argv);
