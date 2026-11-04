import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import questionBank from './data/questions.json';
import {
  buildOptionOrder,
  displayOptions,
  firstUnansweredIndex,
  isValidResult,
  isValidSession,
  letterForOption,
  resolveOptionOrder,
  shuffle,
} from './lib/exam.js';

const SESSION_KEY = 'csa-exam-room:session:v2';
const RESULT_KEY = 'csa-exam-room:result:v2';
const SETTINGS_KEY = 'csa-exam-room:settings:v2';
const LEGACY_KEYS = [
  'csa-exam-room:session:v1',
  'csa-exam-room:result:v1',
  'csa-exam-room:settings:v1',
];

const questionById = new Map(questionBank.map((question) => [question.id, question]));
const BANK_IDS = new Set(questionBank.map((question) => question.id));

const DEFAULT_SETTINGS = {
  length: 'full',
  timed: true,
  shuffle: false,
  shuffleAnswers: true,
};

const LENGTHS = {
  full: { label: 'Full bank', count: 80, duration: 120, detail: 'All questions · 2 hours' },
  focus: { label: 'Focused set', count: 40, duration: 60, detail: '40 random questions · 60 min' },
  sprint: { label: 'Quick sprint', count: 20, duration: 30, detail: '20 random questions · 30 min' },
};

const OPTION_COUNT = questionBank.reduce(
  (max, question) => Math.max(max, question.options?.length ?? 0),
  0,
);

function normalizeSettings(value) {
  const merged = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  return {
    length: LENGTHS[merged.length] ? merged.length : DEFAULT_SETTINGS.length,
    timed: typeof merged.timed === 'boolean' ? merged.timed : DEFAULT_SETTINGS.timed,
    shuffle: typeof merged.shuffle === 'boolean' ? merged.shuffle : DEFAULT_SETTINGS.shuffle,
    shuffleAnswers: typeof merged.shuffleAnswers === 'boolean'
      ? merged.shuffleAnswers
      : DEFAULT_SETTINGS.shuffleAnswers,
  };
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function legacyStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read and validate everything persisted from a previous visit. Invalid data is
 * removed rather than handed to the app, which previously could crash a render.
 */
function loadBoot() {
  const boot = {
    settings: { ...DEFAULT_SETTINGS },
    session: null,
    result: null,
    discarded: false,
    unavailable: false,
  };
  const storage = legacyStorage();
  if (!storage) {
    boot.unavailable = true;
    return boot;
  }
  try {
    const probe = 'csa-exam-room:probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
  } catch {
    boot.unavailable = true;
    return boot;
  }
  for (const key of LEGACY_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore: cleanup is best-effort.
    }
  }
  try {
    const rawSettings = storage.getItem(SETTINGS_KEY);
    if (rawSettings) boot.settings = normalizeSettings(safeParse(rawSettings));
  } catch {
    boot.settings = { ...DEFAULT_SETTINGS };
  }
  try {
    const rawSession = storage.getItem(SESSION_KEY);
    if (rawSession) {
      const parsed = safeParse(rawSession);
      if (isValidSession(parsed, BANK_IDS)) {
        boot.session = parsed;
      } else {
        boot.discarded = true;
        storage.removeItem(SESSION_KEY);
      }
    }
  } catch {
    boot.discarded = true;
  }
  try {
    const rawResult = storage.getItem(RESULT_KEY);
    if (rawResult) {
      const parsed = safeParse(rawResult);
      if (isValidResult(parsed, BANK_IDS)) {
        boot.result = parsed;
      } else {
        boot.discarded = true;
        storage.removeItem(RESULT_KEY);
      }
    }
  } catch {
    boot.discarded = true;
  }
  return boot;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function buildResult(sourceSession) {
  const order = sourceSession.order.filter((id) => questionById.has(id));
  const entries = order.map((id) => {
    const question = questionById.get(id);
    const selected = sourceSession.responses[id] ?? null;
    const outcome = selected === null ? 'unanswered' : selected === question.answer ? 'correct' : 'incorrect';
    return {
      id,
      selected,
      correct: question.answer,
      outcome,
      flagged: Boolean(sourceSession.flagged?.[id]),
      options: resolveOptionOrder(question, sourceSession.optionOrder?.[id]),
    };
  });
  const correct = entries.filter((entry) => entry.outcome === 'correct').length;
  const incorrect = entries.filter((entry) => entry.outcome === 'incorrect').length;
  const unanswered = entries.filter((entry) => entry.outcome === 'unanswered').length;
  const total = entries.length;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - sourceSession.startedAt) / 1000));

  return {
    entries,
    correct,
    incorrect,
    unanswered,
    total,
    score: total ? Math.round((correct / total) * 100) : 0,
    elapsedSeconds,
    mode: sourceSession.mode,
    completedAt: Date.now(),
  };
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
    this.resetSavedData = this.resetSavedData.bind(this);
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('CSA Exam Room crashed:', error, info);
  }

  resetSavedData() {
    const storage = legacyStorage();
    if (storage) {
      for (const key of [SESSION_KEY, RESULT_KEY, SETTINGS_KEY]) {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore: reload may still recover.
        }
      }
    }
    window.location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-shell">
        <main className="results-main" id="main-content" tabIndex={-1}>
          <section className="setup-panel" aria-labelledby="recovery-title">
            <div className="setup-topline"><span>RECOVERY</span><span className="setup-ref">CSA / ERR</span></div>
            <h2 id="recovery-title">The exam room hit an unexpected error.</h2>
            <p className="setup-caption">
              Saved exam data from an older version can cause this. Reset the saved data to continue —
              the question bank and your other tabs are unaffected.
            </p>
            <button className="primary-button start-button" type="button" onClick={this.resetSavedData}>
              <span>Reset saved data &amp; reload</span>
            </button>
          </section>
        </main>
      </div>
    );
  }
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Icon({ name, size = 16 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (name === 'arrow-left') return <svg {...common}><path d="m14 18-6-6 6-6" /><path d="M20 12H8" /></svg>;
  if (name === 'arrow-right') return <svg {...common}><path d="m10 18 6-6-6-6" /><path d="M4 12h12" /></svg>;
  if (name === 'flag') return <svg {...common}><path d="M5 21V4" /><path d="M5 4c5-3 9 3 14 0v11c-5 3-9-3-14 0" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4.2 4.2L19 6.5" /></svg>;
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === 'restart') return <svg {...common}><path d="M4 11a8 8 0 0 1 14-4l2 2" /><path d="M20 4v5h-5" /><path d="M20 13a8 8 0 0 1-14 4l-2-2" /><path d="M4 20v-5h5" /></svg>;
  return null;
}

function TopBar({ right, compact = false, inert = false }) {
  return (
    <header className={`topbar ${compact ? 'topbar-compact' : ''}`} inert={inert ? true : undefined}>
      <div className="brand-lockup">
        <BrandMark />
        <span className="brand-name">CSA <b>/</b> EXAM ROOM</span>
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

function Toggle({ checked, onChange, label, sublabel }) {
  return (
    <button
      className={`setting-toggle ${checked ? 'is-on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-copy">
        <strong>{label}</strong>
        {sublabel && <small>{sublabel}</small>}
      </span>
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </button>
  );
}

function Notices({ notice }) {
  return notice || null;
}

function HomeScreen({
  settings,
  setSettings,
  onStart,
  savedSession,
  lastResult,
  onResume,
  onShowResult,
  notice,
}) {
  const selectedLength = LENGTHS[settings.length];
  const set = (patch) => setSettings((current) => ({ ...current, ...patch }));

  return (
    <div className="page-shell home-page">
      <Notices notice={notice} />
      <TopBar right={<span className="topbar-note"><span className="status-dot" /> PRACTICE ENVIRONMENT</span>} />
      <main className="home-main" id="main-content" tabIndex={-1}>
        <section className="home-intro">
          <div className="eyebrow"><span>01</span> CERTIFIED SOC ANALYST <b>/</b> PRACTICE SYSTEM</div>
          <h1>Think clearly.<br /><em>Respond decisively.</em></h1>
          <p className="home-lede">
            An exam room built around your CSA question bank. Work through realistic SOC scenarios,
            keep your own pace, and see exactly where your understanding needs another pass.
          </p>

          <div className="home-stats" aria-label="Question bank facts">
            <div><strong>{questionBank.length}</strong><span>QUESTIONS</span></div>
            <div><strong>{String(OPTION_COUNT).padStart(2, '0')}</strong><span>OPTIONS EACH</span></div>
            <div><strong>01</strong><span>RESULT REPORT</span></div>
          </div>

          <div className="home-points">
            <div className="home-point">
              <span className="point-index">A</span>
              <div><strong>One question at a time</strong><p>Move through the bank in a focused, exam-style layout.</p></div>
            </div>
            <div className="home-point">
              <span className="point-index">B</span>
              <div><strong>Your answers stay private</strong><p>No correctness feedback or answer reveals until submission.</p></div>
            </div>
            <div className="home-point">
              <span className="point-index">C</span>
              <div><strong>Review the misses</strong><p>See the questions you missed, your choice, and the source answer.</p></div>
            </div>
          </div>

          <div className="source-line">
            <span className="source-marker" />
            <span>QUESTION SOURCE</span>
            <strong>CSA_prep_updated.pdf</strong>
            <span className="source-pages">41 PAGES</span>
          </div>
        </section>

        <aside className="setup-panel" aria-labelledby="setup-title">
          <div className="setup-topline"><span>SESSION SETUP</span><span className="setup-ref">CSA / 01</span></div>
          <h2 id="setup-title">Set your pace.</h2>
          <p className="setup-caption">Choose a session length before entering the exam.</p>

          <fieldset className="length-picker">
            <legend>QUESTION SET</legend>
            {Object.entries(LENGTHS).map(([value, option]) => (
              <label className={`length-option ${settings.length === value ? 'selected' : ''}`} key={value}>
                <input
                  type="radio"
                  name="length"
                  value={value}
                  checked={settings.length === value}
                  onChange={() => set({ length: value })}
                />
                <span className="length-radio" aria-hidden="true" />
                <span className="length-name"><strong>{option.label}</strong><small>{option.detail}</small></span>
                <span className="length-count">{option.count}</span>
              </label>
            ))}
          </fieldset>

          <div className="setup-options">
            <Toggle
              checked={settings.timed}
              onChange={(timed) => set({ timed })}
              label="Time limit"
              sublabel={settings.timed ? `${selectedLength.duration} minutes on the clock` : 'No countdown'}
            />
            <Toggle
              checked={settings.shuffle}
              onChange={(shuffleQuestions) => set({ shuffle: shuffleQuestions })}
              label="Shuffle questions"
              sublabel={settings.shuffle ? 'Question order will be mixed' : 'Keep the source order'}
            />
            <Toggle
              checked={settings.shuffleAnswers}
              onChange={(shuffleAnswers) => set({ shuffleAnswers })}
              label="Shuffle answers"
              sublabel={settings.shuffleAnswers ? 'Option order changes each session' : 'Keep the source option order'}
            />
          </div>

          <button className="primary-button start-button" type="button" onClick={onStart}>
            <span>Begin examination</span><Icon name="arrow-right" size={18} />
          </button>
          <p className="setup-footnote">Your progress is saved in this browser while you work.</p>

          {savedSession && (
            <div className="resume-strip">
              <div>
                <span className="resume-label">SESSION IN PROGRESS</span>
                <strong>{Object.keys(savedSession.responses || {}).length} of {savedSession.order.length} answered</strong>
              </div>
              <button type="button" onClick={onResume}>Resume <Icon name="arrow-right" size={14} /></button>
            </div>
          )}
          {lastResult && !savedSession && (
            <div className="resume-strip last-result-strip">
              <div>
                <span className="resume-label">PREVIOUS RESULT</span>
                <strong>{lastResult.score}% · {lastResult.correct}/{lastResult.total} correct</strong>
              </div>
              <button type="button" onClick={onShowResult}>Review <Icon name="arrow-right" size={14} /></button>
            </div>
          )}
        </aside>
      </main>

      <footer className="home-footer">
        <span>CSA / EXAM ROOM <b>·</b> LOCAL PRACTICE TOOL</span>
        <span>ANSWER KEY IS REVEALED AFTER SUBMISSION</span>
      </footer>
    </div>
  );
}

function QuestionNavigator({ session, currentIndex, onJump }) {
  const order = session.order;
  return (
    <aside className="navigator-panel" aria-label="Question navigator">
      <div className="navigator-heading">
        <span>QUESTION MAP</span>
        <strong>{String(order.length).padStart(2, '0')} <small>ITEMS</small></strong>
      </div>
      <div className="navigator-grid">
        {order.map((id, index) => {
          const answered = session.responses[id] !== undefined;
          const flagged = Boolean(session.flagged?.[id]);
          const current = index === currentIndex;
          const classes = [
            'navigator-number',
            current ? 'is-current' : '',
            answered ? 'is-answered' : '',
            flagged ? 'is-flagged' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              className={classes}
              type="button"
              key={id}
              onClick={() => onJump(index)}
              aria-label={`Go to question ${index + 1} of ${order.length}${answered ? ', answered' : ', unanswered'}${flagged ? ', marked for review' : ''}`}
              aria-current={current ? 'step' : undefined}
            >
              {String(id).padStart(2, '0')}
              {flagged && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="navigator-legend">
        <span><i className="legend-current" /> Current</span>
        <span><i className="legend-answered" /> Answered</span>
        <span><i className="legend-flagged" /> Review</span>
      </div>
      <div className="navigator-tip"><span>TIP</span> Use the number keys 1–4 to select an answer. Use ← and → to move.</div>
    </aside>
  );
}

function ConfirmSubmit({ unanswered, flagged, onJumpToUnanswered, onContinue, onConfirm }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    restoreRef.current = document.activeElement;
    const focusable = () => Array.from(
      dialog?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((element) => !element.disabled);
    const list = focusable();
    (list[0] ?? dialog)?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onContinue();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      const previous = restoreRef.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [onContinue]);

  const summary = [];
  if (unanswered > 0) {
    summary.push(`There ${unanswered === 1 ? 'is' : 'are'} ${unanswered} unanswered ${unanswered === 1 ? 'question' : 'questions'}. They will be counted as incorrect.`);
  } else {
    summary.push('You have answered every question. Your results will be calculated as soon as you submit.');
  }
  if (flagged > 0) {
    summary.push(`${flagged} ${flagged === 1 ? 'question is' : 'questions are'} marked for review.`);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onContinue(); }}>
      <section
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-kicker">SUBMIT EXAMINATION</div>
        <h2 id="confirm-title">Ready to hand it in?</h2>
        <p id="confirm-desc">{summary.join(' ')}</p>
        <div className="modal-actions">
          {unanswered > 0 && (
            <button className="secondary-button" type="button" onClick={onJumpToUnanswered}>
              Jump to first unanswered
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onContinue}>Keep working</button>
          <button className="primary-button" type="button" onClick={onConfirm}>Submit exam <Icon name="arrow-right" size={16} /></button>
        </div>
      </section>
    </div>
  );
}

function QuestionBody({ question, headingRef }) {
  const ask = question.ask || question.prompt;
  if (!question.scenario) {
    return <h1 id="question-heading" tabIndex={-1} ref={headingRef}>{ask}</h1>;
  }
  return (
    <>
      <p className="question-scenario">{question.scenario}</p>
      <h1 id="question-heading" className="question-ask" tabIndex={-1} ref={headingRef}>{ask}</h1>
    </>
  );
}

function ExamScreen({ session, setSession, onFinish, notice }) {
  const [currentIndex, setCurrentIndex] = useState(session.currentIndex || 0);
  const [showMap, setShowMap] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(
    session.deadline ? Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000)) : null,
  );
  const headingRef = useRef(null);
  const optionRefs = useRef([]);
  const displayedRef = useRef([]);
  const warnedRef = useRef(new Set());
  const openerRef = useRef(null);

  const questionId = session.order[currentIndex];
  const question = questionById.get(questionId);
  const optionOrder = session.optionOrder?.[questionId];
  const displayed = useMemo(() => displayOptions(question, optionOrder), [question, optionOrder]);
  displayedRef.current = displayed;

  const answeredCount = session.order.filter((id) => session.responses[id] !== undefined).length;
  const progress = Math.round((answeredCount / session.order.length) * 100);
  const isLast = currentIndex === session.order.length - 1;
  const selected = question ? (session.responses[questionId] ?? null) : null;
  const flagged = Boolean(session.flagged?.[questionId]);
  const flaggedCount = session.order.filter((id) => session.flagged?.[id]).length;

  const closeConfirm = useCallback(() => {
    setConfirmOpen(false);
    const opener = openerRef.current;
    if (opener) {
      window.requestAnimationFrame(() => {
        if (document.contains(opener)) opener.focus({ preventScroll: true });
      });
    }
  }, []);

  const openConfirm = useCallback(() => {
    // Capture the opener before the background becomes inert (which can blur it).
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmOpen(true);
  }, []);

  useEffect(() => {
    setSession((current) => (current ? { ...current, currentIndex } : current));
  }, [currentIndex, setSession]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [currentIndex]);

  useEffect(() => {
    if (!session.deadline) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
      setTimeRemaining(left);
      if (left <= 300 && !warnedRef.current.has(300)) {
        warnedRef.current.add(300);
        const minutes = Math.max(1, Math.ceil(left / 60));
        setAnnouncement(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining.`);
      }
      if (left <= 60 && !warnedRef.current.has(60)) {
        warnedRef.current.add(60);
        setAnnouncement('1 minute remaining.');
      }
      if (left === 0) onFinish();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session.deadline, onFinish]);

  const selectAnswer = useCallback((optionId) => {
    setSession((current) => (current ? {
      ...current,
      responses: { ...current.responses, [questionId]: optionId },
    } : current));
    const letter = letterForOption(question, optionOrder, optionId);
    setAnnouncement(`Question ${currentIndex + 1}: answer ${letter ?? optionId} saved.`);
  }, [questionId, currentIndex, question, optionOrder, setSession]);

  const jump = useCallback((index) => {
    setCurrentIndex(Math.min(session.order.length - 1, Math.max(0, index)));
    setShowMap(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [session.order.length]);

  const toggleFlag = useCallback(() => {
    setSession((current) => (current ? {
      ...current,
      flagged: { ...current.flagged, [questionId]: !current.flagged?.[questionId] },
    } : current));
    setAnnouncement(flagged ? 'Review mark removed.' : 'Question marked for review.');
  }, [flagged, questionId, setSession]);

  const onOptionsKeyDown = (event) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key) || displayed.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentPosition = displayed.findIndex((entry) => entry.option.id === selected);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = displayed.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = currentPosition === -1 ? 0 : (currentPosition + 1) % displayed.length;
    } else {
      next = currentPosition === -1 ? displayed.length - 1 : (currentPosition - 1 + displayed.length) % displayed.length;
    }
    const target = displayed[next];
    if (!target) return;
    selectAnswer(target.option.id);
    optionRefs.current[next]?.focus();
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (confirmOpen) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest('[role="radio"]') || target.closest('[role="dialog"]')) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((index) => Math.min(session.order.length - 1, index + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((index) => Math.max(0, index - 1));
      } else if (['1', '2', '3', '4'].includes(event.key)) {
        const target = displayedRef.current[Number(event.key) - 1];
        if (target) selectAnswer(target.option.id);
      } else if (event.key.toLowerCase() === 'm') {
        toggleFlag();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen, session.order.length, selectAnswer, toggleFlag]);

  const remainingCount = session.order.length - answeredCount;
  const timerUrgent = timeRemaining !== null && timeRemaining <= 300;
  const activeOptionId = selected ?? displayed[0]?.option.id ?? null;

  if (!question) {
    return (
      <div className="page-shell exam-page">
        <Notices notice={notice} />
        <TopBar compact />
        <main className="exam-layout" id="main-content" tabIndex={-1}>
          <section className="question-stage">
            <div className="app-notice app-notice-warn" role="status">
              <span className="app-notice-text">Question {questionId} is no longer available in the question bank.</span>
            </div>
            <button className="primary-button" type="button" onClick={onFinish}>End this session</button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell exam-page">
      <Notices notice={notice} />
      <TopBar
        compact
        inert={confirmOpen}
        right={(
          <div className="exam-topbar-meta">
            <span className="topbar-progress-copy">{answeredCount} <b>/</b> {session.order.length} ANSWERED</span>
            {session.deadline && (
              <span
                className={`timer-chip ${timerUrgent ? 'timer-urgent' : ''}`}
                role="timer"
                aria-label={`${formatTime(timeRemaining ?? 0)} remaining`}
              >
                <Icon name="clock" size={15} /> <strong>{formatTime(timeRemaining ?? 0)}</strong>
              </span>
            )}
            <button
              className="text-action submit-top"
              type="button"
              onClick={openConfirm}
              aria-haspopup="dialog"
            >
              <span className="submit-label-full">Review &amp; submit</span>
              <span className="submit-label-short">Submit</span>
            </button>
          </div>
        )}
      />
      <div
        className="exam-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label={`${progress}% of questions answered`}
        inert={confirmOpen ? true : undefined}
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <main className="exam-layout" id="main-content" tabIndex={-1} inert={confirmOpen ? true : undefined}>
        <div className={`mobile-map-wrap ${showMap ? 'is-open' : ''}`}>
          <button type="button" className="mobile-map-toggle" onClick={() => setShowMap((value) => !value)} aria-expanded={showMap}>
            <span>Question map</span><strong>{answeredCount}/{session.order.length} answered</strong><span className="map-toggle-icon">{showMap ? '−' : '+'}</span>
          </button>
          {showMap && <QuestionNavigator session={session} currentIndex={currentIndex} onJump={jump} />}
        </div>
        <div className="desktop-navigator">
          <QuestionNavigator session={session} currentIndex={currentIndex} onJump={jump} />
        </div>

        <section className="question-stage" aria-labelledby="question-heading">
          <div className="question-stage-top">
            <div className="question-identity">
              <span className="question-label">QUESTION <b>{String(question.id).padStart(2, '0')}</b></span>
              <span className="question-divider" />
              <span className="question-index">{String(currentIndex + 1).padStart(2, '0')} OF {String(session.order.length).padStart(2, '0')}</span>
            </div>
            <button className={`flag-button ${flagged ? 'is-flagged' : ''}`} type="button" onClick={toggleFlag} aria-pressed={flagged}>
              <Icon name="flag" size={15} /> {flagged ? 'Marked for review' : 'Mark for review'}
            </button>
          </div>

          <div className="question-content" key={question.id}>
            <div className="answer-instruction">SELECT ONE ANSWER</div>
            <QuestionBody question={question} headingRef={headingRef} />
            <div
              className="options-list"
              role="radiogroup"
              aria-label={`Answer choices for question ${currentIndex + 1}`}
              onKeyDown={onOptionsKeyDown}
            >
              {displayed.map(({ letter, option }, index) => {
                const active = selected === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`answer-option ${active ? 'is-selected' : ''}`}
                    onClick={() => selectAnswer(option.id)}
                    tabIndex={option.id === activeOptionId ? 0 : -1}
                    ref={(element) => { optionRefs.current[index] = element; }}
                  >
                    <span className="option-letter">{letter}</span>
                    <span className="option-text">{option.text}</span>
                    <span className="option-indicator" aria-hidden="true">{active ? <Icon name="check" size={15} /> : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="question-footer">
            <button className="secondary-button previous-button" type="button" onClick={() => jump(currentIndex - 1)} disabled={currentIndex === 0}>
              <Icon name="arrow-left" size={16} /> Previous
            </button>
            <div className="question-footer-status">
              {selected ? <><span className="answered-indicator" /> Answer saved</> : <><span className="unanswered-indicator" /> Not answered</>}
              {flagged && <span className="footer-flag">· Marked for review</span>}
            </div>
            {isLast ? (
              <button className="primary-button next-button" type="button" onClick={openConfirm}>
                Review &amp; submit <Icon name="arrow-right" size={16} />
              </button>
            ) : (
              <button className="primary-button next-button" type="button" onClick={() => jump(currentIndex + 1)}>
                Next question <Icon name="arrow-right" size={16} />
              </button>
            )}
          </div>
          <div className="exam-bottom-note">
            <span>{remainingCount} {remainingCount === 1 ? 'question' : 'questions'} still unanswered</span>
            <span>YOUR ANSWERS ARE NOT GRADED UNTIL SUBMISSION</span>
          </div>
        </section>
      </main>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

      {confirmOpen && (
        <ConfirmSubmit
          unanswered={remainingCount}
          flagged={flaggedCount}
          onJumpToUnanswered={() => {
            setConfirmOpen(false);
            jump(firstUnansweredIndex(session));
          }}
          onContinue={closeConfirm}
          onConfirm={() => {
            setConfirmOpen(false);
            onFinish();
          }}
        />
      )}
    </div>
  );
}

function ReviewItem({ entry }) {
  const question = questionById.get(entry.id);
  if (!question) {
    return (
      <div className="review-item">
        <div className="review-detail">
          <p className="review-prompt">Question {entry.id} is no longer available in the question bank.</p>
        </div>
      </div>
    );
  }
  const displayed = displayOptions(question, entry.options);
  const selectedEntry = displayed.find((item) => item.option.id === entry.selected) ?? null;
  const correctEntry = displayed.find((item) => item.option.id === entry.correct) ?? null;
  const statusLabel = entry.outcome === 'correct' ? 'Correct' : entry.outcome === 'unanswered' ? 'Not answered' : 'Incorrect';

  return (
    <details className={`review-item review-${entry.outcome}`}>
      <summary>
        <span className="review-number">{String(entry.id).padStart(2, '0')}</span>
        <span className="review-summary-text"><strong>Question {entry.id}</strong><small>{question.prompt.slice(0, 104)}{question.prompt.length > 104 ? '…' : ''}</small></span>
        <span className={`review-status status-${entry.outcome}`}>{statusLabel}</span>
        <span className="review-chevron">+</span>
      </summary>
      <div className="review-detail">
        <p className="review-prompt">{question.prompt}</p>
        <div className="review-answer-grid">
          <div className={`review-answer-box ${entry.outcome === 'correct' ? 'answer-good' : 'answer-bad'}`}>
            <span>YOUR ANSWER</span>
            <strong>{selectedEntry ? `${selectedEntry.letter}. ${selectedEntry.option.text}` : 'Not answered'}</strong>
          </div>
          <div className="review-answer-box answer-good">
            <span>ANSWER KEY</span>
            <strong>{correctEntry ? `${correctEntry.letter}. ${correctEntry.option.text}` : entry.correct}</strong>
          </div>
        </div>
        <div className="review-options">
          {displayed.map(({ letter, option }) => {
            const isChosen = entry.selected === option.id;
            const isCorrect = entry.correct === option.id;
            return (
              <div className={`review-option ${isCorrect ? 'is-correct' : ''} ${isChosen && !isCorrect ? 'is-wrong' : ''}`} key={option.id}>
                <span>{letter}</span><p>{option.text}</p>
                {isCorrect && <b>KEY</b>}
                {isChosen && !isCorrect && <b>YOUR PICK</b>}
              </div>
            );
          })}
        </div>
        <div className="explanation-block">
          <span className="explanation-label">EXPLANATION</span>
          <p>{question.explanation || 'No explanation was included for this question in the supplied PDF.'}</p>
        </div>
        {question.sourceNote && (
          <div className={`source-note ${question.answerStatus === 'conflict' ? 'source-note-warning' : ''}`}>
            <strong>{question.answerStatus === 'conflict' ? 'SOURCE KEY CONFLICT' : 'ANSWER KEY NOTE'}</strong>
            <p>{question.sourceNote}</p>
          </div>
        )}
      </div>
    </details>
  );
}

function ResultsScreen({ result, onRetry, onHome, notice }) {
  const [filter, setFilter] = useState('missed');
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const missedEntries = result.entries.filter((entry) => entry.outcome !== 'correct');
  const unansweredEntries = result.entries.filter((entry) => entry.outcome === 'unanswered');
  const flaggedEntries = result.entries.filter((entry) => entry.flagged);
  const sourceNotes = result.entries.filter((entry) => questionById.get(entry.id)?.sourceNote);
  const entries = filter === 'all'
    ? result.entries
    : filter === 'unanswered'
      ? unansweredEntries
      : filter === 'flagged'
        ? flaggedEntries
        : filter === 'source'
          ? sourceNotes
          : missedEntries;

  const filters = [
    { id: 'missed', label: 'Missed', count: missedEntries.length },
    { id: 'unanswered', label: 'Unanswered', count: unansweredEntries.length },
    { id: 'flagged', label: 'Marked', count: flaggedEntries.length },
    { id: 'all', label: 'All', count: result.total },
    { id: 'source', label: 'Source notes', count: sourceNotes.length },
  ];

  return (
    <div className="page-shell results-page">
      <Notices notice={notice} />
      <TopBar right={<span className="topbar-note"><span className="status-dot status-dot-done" /> SESSION COMPLETE</span>} />
      <main className="results-main" id="main-content" tabIndex={-1}>
        <div className="results-eyebrow"><span>RESULT REPORT</span><b>/</b><span>{new Date(result.completedAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span></div>
        <section className="results-hero">
          <div className="results-title-block">
            <h1 ref={headingRef} tabIndex={-1}>Session<br /><em>complete.</em></h1>
            <p>You got <strong>{result.correct} out of {result.total}</strong> questions right. Take a look at the misses and use them to focus your next round.</p>
            <div className="results-actions">
              <button className="primary-button" type="button" onClick={onRetry}><Icon name="restart" size={16} /> Run another session</button>
              <button className="text-action" type="button" onClick={onHome}>Back to setup <Icon name="arrow-right" size={15} /></button>
            </div>
          </div>
          <div className="score-panel">
            <span className="score-label">YOUR SCORE</span>
            <div className="score-number">{result.score}<span>%</span></div>
            <div className="score-track"><span style={{ width: `${result.score}%` }} /></div>
            <div className="score-foot"><strong>{result.correct} correct</strong><span>{result.total} total</span></div>
          </div>
        </section>

        <section className="result-stats" aria-label="Score breakdown">
          <div><span className="stat-caption">CORRECT</span><strong className="stat-correct">{String(result.correct).padStart(2, '0')}</strong></div>
          <div><span className="stat-caption">INCORRECT</span><strong className="stat-incorrect">{String(result.incorrect).padStart(2, '0')}</strong></div>
          <div><span className="stat-caption">UNANSWERED</span><strong>{String(result.unanswered).padStart(2, '0')}</strong></div>
          <div><span className="stat-caption">TIME USED</span><strong className="stat-time">{formatElapsed(result.elapsedSeconds)}</strong></div>
        </section>

        <section className="review-section">
          <div className="review-heading-row">
            <div>
              <div className="eyebrow"><span>02</span> PERFORMANCE REVIEW</div>
              <h2>Make the misses useful.</h2>
              <p>Open any question to compare your choice with the answer key.</p>
            </div>
            <div className="review-total"><strong>{missedEntries.length}</strong><span>TO REVISIT</span></div>
          </div>

          {sourceNotes.length > 0 && (
            <div className="source-integrity-banner">
              <span className="source-warning-mark">!</span>
              <div><strong>{sourceNotes.length} answer-key note{sourceNotes.length > 1 ? 's' : ''} in this session</strong><p>{sourceNotes.map((entry) => `Q${entry.id}: ${questionById.get(entry.id).answerStatus === 'conflict' ? 'printed answer conflicts with its explanation' : 'answer key inferred because the PDF omits it'}`).join(' · ')}. See the individual review notes before relying on these keys.</p></div>
            </div>
          )}

          <div className="review-controls">
            <div className="review-tabs" role="group" aria-label="Filter review questions">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  className={filter === item.id ? 'active' : ''}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label} <b>{item.count}</b>
                </button>
              ))}
            </div>
            <span className="review-control-note">SELECT A QUESTION TO EXPAND</span>
          </div>

          {entries.length === 0 ? (
            <div className="empty-review">
              <span className="empty-check"><Icon name="check" size={20} /></span>
              <strong>{filter === 'missed' ? 'Clean run.' : `No ${filter === 'source' ? 'source notes' : filter} questions.`}</strong>
              <p>{filter === 'missed' ? 'Every answered question matched the supplied answer key.' : 'There are no questions in this category for this session.'}</p>
            </div>
          ) : (
            <div className="review-list">
              {entries.map((entry) => <ReviewItem key={entry.id} entry={entry} />)}
            </div>
          )}
        </section>
      </main>
      <footer className="home-footer results-footer">
        <span>CSA / EXAM ROOM <b>·</b> PRACTICE REPORT</span>
        <span>REVIEW THE SOURCE NOTES BEFORE RELYING ON AMBIGUOUS KEYS</span>
      </footer>
    </div>
  );
}

function ExamApp() {
  const [boot] = useState(loadBoot);
  const [settings, setSettings] = useState(boot.settings);
  const [session, setSession] = useState(boot.session);
  const [result, setResult] = useState(boot.result);
  const [view, setView] = useState('home');
  const [storageOk, setStorageOk] = useState(!boot.unavailable);
  const [discarded, setDiscarded] = useState(boot.discarded);
  const [externalChange, setExternalChange] = useState(false);
  const sessionRef = useRef(session);
  const submittedRef = useRef(false);

  const persist = useCallback((key, value) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      setStorageOk(true);
      return true;
    } catch {
      setStorageOk(false);
      return false;
    }
  }, []);

  useEffect(() => {
    sessionRef.current = session;
    if (session) persist(SESSION_KEY, session);
  }, [session, persist]);

  useEffect(() => {
    persist(SETTINGS_KEY, settings);
  }, [settings, persist]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === SESSION_KEY || event.key === RESULT_KEY) setExternalChange(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const startExam = () => {
    const config = LENGTHS[settings.length] ?? LENGTHS.full;
    let order = questionBank.map((question) => question.id);
    if (settings.length !== 'full') {
      order = shuffle(order).slice(0, config.count).sort((a, b) => a - b);
    }
    if (settings.shuffle) order = shuffle(order);

    const optionOrder = {};
    for (const id of order) {
      const question = questionById.get(id);
      if (!question) continue;
      // Items carrying a source-note reference option letters from the PDF, so
      // they keep the source order and those notes stay accurate.
      optionOrder[id] = buildOptionOrder(question, settings.shuffleAnswers && !question.sourceNote);
    }

    const nextSession = {
      order,
      responses: {},
      flagged: {},
      optionOrder,
      currentIndex: 0,
      startedAt: Date.now(),
      deadline: settings.timed ? Date.now() + config.duration * 60 * 1000 : null,
      mode: settings.length,
    };
    submittedRef.current = false;
    sessionRef.current = nextSession;
    setSession(nextSession);
    setView('exam');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const resumeExam = () => {
    if (!session) return;
    submittedRef.current = false;
    setView('exam');
  };

  const finishExam = useCallback(() => {
    if (submittedRef.current) return;
    const latest = sessionRef.current;
    if (!latest) return;
    submittedRef.current = true;
    const finalResult = buildResult(latest);
    setResult(finalResult);
    persist(RESULT_KEY, finalResult);
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      setStorageOk(false);
    }
    sessionRef.current = null;
    setSession(null);
    setView('results');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [persist]);

  const notice = (
    <>
      {!storageOk && (
        <div className="app-notice app-notice-warn" role="status">
          <span className="app-notice-text">
            Progress can’t be saved — this browser is blocking local storage or it is full.
            Keep this tab open, or your answers will be lost.
          </span>
        </div>
      )}
      {discarded && (
        <div className="app-notice app-notice-info" role="status">
          <span className="app-notice-text">Saved exam data from an older version was cleared because it could not be read.</span>
          <button className="app-notice-action" type="button" onClick={() => setDiscarded(false)}>Dismiss</button>
        </div>
      )}
      {externalChange && (
        <div className="app-notice app-notice-info" role="status">
          <span className="app-notice-text">This exam was changed in another tab. Reload to pick up the latest state.</span>
          <button className="app-notice-action" type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
    </>
  );

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {view === 'home' && (
        <HomeScreen
          settings={settings}
          setSettings={setSettings}
          onStart={startExam}
          savedSession={session}
          lastResult={result}
          onResume={resumeExam}
          onShowResult={() => { if (result) setView('results'); }}
          notice={notice}
        />
      )}
      {view === 'exam' && session && (
        <ExamScreen
          session={session}
          setSession={setSession}
          onFinish={finishExam}
          notice={notice}
        />
      )}
      {view === 'results' && result && (
        <ResultsScreen
          result={result}
          onRetry={startExam}
          onHome={() => setView('home')}
          notice={notice}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ExamApp />
    </ErrorBoundary>
  );
}
