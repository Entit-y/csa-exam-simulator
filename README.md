# CSA Exam Room

A static React exam simulator built from the 80 questions in `CSA_prep_updated.pdf`. It is designed to deploy to GitHub Pages; there is no backend, database, or server runtime.

## Features

- Full 80-question exam, 40-question focus set, or 20-question sprint
- Optional countdown and question shuffling
- Optional answer-option shuffling with stable, per-session lettering
- One-question-at-a-time interface with previous/next controls and a question map
- Mark-for-review flags, keyboard shortcuts, and browser-local session recovery
- Automatic scoring with incorrect and unanswered questions separated in the review
- Answer comparisons and source explanations where the PDF supplied them
- Responsive layout, reduced-motion support, visible focus, and screen-reader announcements

## Run locally

Requirements: Node.js 22 or later.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

To create a production build:

```bash
npm run build
npm run preview
```

The generated static site is written to `dist/`.

The build validates the question bank first (`npm run validate:questions`); run it on its own to check data edits:

```bash
npm run validate:questions
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. Open **Settings → Pages** in the repository.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Push to `main` (or run the **Deploy CSA Exam Room to GitHub Pages** workflow manually).
5. GitHub Actions builds the Vite app and publishes `dist/` automatically.

The Vite config detects the GitHub repository name in Actions and sets the project-page base path automatically. For a custom domain, change `base` in `vite.config.js` to `/` before deploying. A user/organization site named `<owner>.github.io` is already configured to use `/`.

## Exam data and answer-key notes

The question text and answer options are transcribed from the supplied PDF. Explanations are included only where the PDF provided one.

The supplied key has been verified against the PDF's own answer text and the question content. Corrections and remaining caveats are surfaced in the results review:

- **Question 16:** the printed key says **D**, but the explanation and the described TTPs (admin shares, stolen domain credentials, scheduled tasks, remote execution) match **C**. The app scores **C** and flags the printed conflict.
- **Question 31:** the printed key says **Event**, but the stem has the SIEM flagging the activity and a ticket opened for triage — that is an **Alert**. The app scores **C**.
- **Question 38:** the printed key says **Setup**, but enabling RDP is a service state change recorded in the **System** log; Setup records role/feature installation. The app scores **D**.
- **Question 63:** the printed key uses a non-standard taxonomy (tactical = TTPs, operational = tooling). Under the standard strategic/operational/tactical/technical model the mapping is **D**, which the app scores.
- **Question 69:** the printed key says **4618** ("a monitored security event pattern"), which has nothing to do with time. The app scores **C (4616, "the system time was changed")** and annotates the correction.
- **Question 77:** the PDF does not print an answer. The app uses **C** as an inference from the scenario and labels it as unverified.
- **Question 59:** the original stem gave no way to choose between **NetFlow** and **IPFIX**. The stem now requires an IETF standards-track, vendor-neutral flow-export format, so the app scores **A (IPFIX)**.
- **Data repairs:** Q20's option D was transcribed from a different question and is corrected; Q60's option C is restored to **DNS Spoofing** (the PDF's own explanation discusses it, but the compiled option list substituted "DNS blacklisting"); Q80's option D duplicated the meaning of the keyed answer and was replaced; Q61's malformed `netstat` option was repaired and its stem aligned.

These notes are surfaced rather than silently normalized. Review them against your instructor's key.

## Project structure

```text
src/
  data/questions.json    # 80-question bank, source-key metadata, scenario/ask split
  lib/exam.js            # Option ordering, session/result validation helpers
  App.jsx                # Exam, setup, navigation, grading, and review UI
  styles.css             # Responsive design system and motion
  main.jsx               # React entry point
scripts/
  split-prompts.mjs      # Regenerates the scenario/ask fields (idempotent)
  validate-questions.mjs # Question-bank integrity gate used by the build
.github/workflows/
  deploy.yml              # GitHub Pages deployment pipeline
```

All active answers and progress are kept in the browser's `localStorage`. Clearing site data removes the saved session and last result.
