// Pure helpers for session state, answer-option ordering, and storage validation.
// Kept free of React and browser globals so they can be reasoned about in isolation.

export const LETTERS = ['A', 'B', 'C', 'D'];
export const MODES = ['full', 'focus', 'sprint'];
export const OUTCOMES = ['correct', 'incorrect', 'unanswered'];

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Option ids in the order they should be displayed for a fresh session. */
export function buildOptionOrder(question, shouldShuffle = false, random = Math.random) {
  const ids = Array.isArray(question?.options) ? question.options.map((option) => option.id) : [];
  return shouldShuffle ? shuffle(ids, random) : ids;
}

/**
 * Recover a usable display order for a question. Falls back to the question's
 * source order whenever the stored order is missing or inconsistent, so stale
 * or hand-edited session data can never reorder options into an invalid state.
 */
export function resolveOptionOrder(question, order) {
  const ids = Array.isArray(question?.options) ? question.options.map((option) => option.id) : [];
  if (!Array.isArray(order) || order.length !== ids.length) return ids;
  if (new Set(order).size !== ids.length) return ids;
  if (!order.every((id) => ids.includes(id))) return ids;
  return order;
}

/** [{ letter, option }] with letters assigned by display position. */
export function displayOptions(question, order) {
  const byId = new Map((question?.options ?? []).map((option) => [option.id, option]));
  return resolveOptionOrder(question, order)
    .map((id, index) => ({ letter: LETTERS[index], option: byId.get(id) }))
    .filter((entry) => entry.option);
}

/** The letter a user actually sees for a given source option id. */
export function letterForOption(question, order, optionId) {
  if (!optionId) return null;
  const match = displayOptions(question, order).find((entry) => entry.option.id === optionId);
  return match ? match.letter : null;
}

export function firstUnansweredIndex(session) {
  if (!Array.isArray(session?.order)) return 0;
  const index = session.order.findIndex((id) => session?.responses?.[id] === undefined);
  return index === -1 ? 0 : index;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOptionId(value) {
  return typeof value === 'string' && LETTERS.includes(value);
}

export function isValidSession(value, knownIds) {
  if (!isPlainObject(value)) return false;
  const { order, responses, flagged, currentIndex, startedAt, deadline, mode, optionOrder } = value;
  if (!Array.isArray(order) || order.length === 0) return false;
  if (!order.every((id) => Number.isInteger(id) && (!knownIds || knownIds.has(id)))) return false;
  if (!isPlainObject(responses) || !isPlainObject(flagged)) return false;
  if (!order.every((id) => responses[id] === undefined || isOptionId(responses[id]))) return false;
  if (!Object.values(flagged).every((mark) => typeof mark === 'boolean')) return false;
  if (!Number.isFinite(startedAt)) return false;
  if (!(deadline === null || deadline === undefined || Number.isFinite(deadline))) return false;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= order.length) return false;
  if (!MODES.includes(mode)) return false;
  if (optionOrder !== undefined) {
    if (!isPlainObject(optionOrder)) return false;
    const ordersValid = order.every((id) => {
      if (!(id in optionOrder)) return true;
      const stored = optionOrder[id];
      if (!Array.isArray(stored)) return false;
      if (!stored.every(isOptionId)) return false;
      return new Set(stored).size === stored.length;
    });
    if (!ordersValid) return false;
  }
  return true;
}

export function isValidResult(value, knownIds) {
  if (!isPlainObject(value)) return false;
  const { entries, correct, incorrect, unanswered, total, score, elapsedSeconds, completedAt, mode } = value;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (![correct, incorrect, unanswered, total].every((count) => Number.isInteger(count) && count >= 0)) return false;
  if (correct + incorrect + unanswered !== total) return false;
  if (!Number.isInteger(score) || score < 0 || score > 100) return false;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return false;
  if (!Number.isFinite(completedAt)) return false;
  if (!MODES.includes(mode)) return false;
  return entries.every((entry) => {
    if (!isPlainObject(entry)) return false;
    if (!Number.isInteger(entry.id) || (knownIds && !knownIds.has(entry.id))) return false;
    if (!OUTCOMES.includes(entry.outcome)) return false;
    if (!isOptionId(entry.correct)) return false;
    if (!(entry.selected === null || isOptionId(entry.selected))) return false;
    if (typeof entry.flagged !== 'boolean') return false;
    if (entry.options !== undefined) {
      if (!Array.isArray(entry.options) || !entry.options.every(isOptionId)) return false;
      if (new Set(entry.options).size !== entry.options.length) return false;
    }
    return true;
  });
}
