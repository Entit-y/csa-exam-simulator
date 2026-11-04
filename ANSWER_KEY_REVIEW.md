# Answer-key verification — `CSA_prep_updated.pdf`

Source audited: `C:\Users\hi\Downloads\CSA_prep_updated.pdf` (42 pages, compiled by a third party).
App audited: `src/data/questions.json` (80 questions) as deployed.
Date: 2026-11-04.

> **Status: fixes applied and reviewed.** Round 1: Q16 → C, Q69 → C, option repairs (Q20/Q61/Q80), Q39 stem corrected, ambiguity notes added. Round 2 (after discussion): Q31 → C, Q38 → D, Q63 → D, Q60 option C restored to "DNS Spoofing" (key stays D). Round 3: Q59's stem gained the missing differentiator and now scores A (IPFIX). See the README for the shipped state and the follow-up section at the end.

## TL;DR

| Result | Count |
|---|---|
| Questions audited | 80 |
| **Keys correct and unambiguous** | **73** |
| **Keys objectively wrong** | **2** — Q16 and Q69 |
| **Ambiguous / question-defective** | **5** — Q31, Q38, Q59, Q60, Q63 |
| Printed keys in the PDF | 79 (Q77 has none) |
| App letters that match the printed PDF letters | 79 / 79 |
| App option texts that match the PDF | 79 / 80 (Q20 is wrong) |

The PDF's key is the source of both errors: the app faithfully copies the printed letters, including the wrong ones.
Two of the 79 printed keys are wrong, and the questions worth fixing first are **Q16** and **Q69**.

## How this was verified

1. Extracted the PDF text (42 pages) and parsed all 80 numbered questions, four options each, plus the printed keys. The document uses two key formats — inline `Answer: X` for 71 questions and a separate `Correct Answer: X.` block after Q16–Q20 — which had to be mapped back to the right questions.
2. **Letter cross-check**: compared every printed key with the app's `answer` field. All 79 match.
3. **Key-text cross-check**: 42 printed keys also state the answer in words. 41 of those match the keyed option exactly; **1 conflicts (Q16)**.
4. **Transcription cross-check**: fuzzy-compared all 80 stems and 320 option texts against the PDF. Everything matches except **Q20 option D**.
5. **Content audit**: each question was judged independently against SOC/CSA knowledge, then every flagged item was re-checked by hand before being included here. Judgement call, not an authority — see caveats.

## Keys that are wrong

### Q16 — app key **D**, should be **C**

Scenario: a workstation uses admin shares (`C$`, `ADMIN$`) against 50+ internal hosts, logs in with stolen domain-admin credentials, creates scheduled tasks, spawns `cmd.exe` remotely, and shows token impersonation and NetSession enumeration.

- **C. Lateral movement using stolen domain credentials** is the objective these TTPs describe.
- **D. Command and control using named pipes** is not supported by the scenario.
- The PDF contradicts itself: it prints **D** but its own key text says *"Lateral movement using stolen domain credentials"* — i.e., option C — and its explanation argues for lateral movement.
- The app already detects this (`answerStatus: "conflict"`) but **still scores D**, so a correct user is marked wrong.

### Q69 — app key **D (4618)**, should be **C (4616)**

Scenario asks which Windows Event ID records *system time synchronization with an external source*. Options: 4608, 4609, 4616, 4618.

- **4616 = "The system time was changed"** — the only option that records a clock change, and therefore the closest correct answer for a time sync.
- **4618 = "A monitored security event pattern has occurred"** — unrelated to time.
- 4608/4609 are system startup/shutdown. The keyed D is simply the wrong event class.
- (Strictly, Windows Time-Service also logs sync details in the System log as Time-Service events; 4616 is the only defensible choice among these four.)

## Ambiguous or defective questions (no clear single right answer)

| Q | Key | Alternative | Why it is ambiguous |
|---|---|---|---|
| Q31 | B — Event | C — Alert | The SIEM already flagged the activity and the analyst opened a ticket. "Event" vs "Alert" depends on an undefined log→event→alert→incident taxonomy. Only "not an incident" is safe. |
| Q38 | A — Setup | D — System | Stem asks for the log that records "enabling services **or** modifying server roles". Role/feature installs go to Setup; service state changes go to System (SCM). Both fit the wording. |
| Q59 | B — NetFlow | A — IPFIX | IPFIX is the IETF-standard successor to NetFlow and satisfies every stated requirement equally. The stem gives no differentiator. |
| Q60 | D — DNS Blackholing | C — DNS blacklisting | Both block resolution of known malicious domains and fit all criteria. The explanation also justifies "DNS Spoofing", which is not even one of the options — a stale/wrong explanation. |
| Q63 | A — 1-Strategic 2-Technical 3-Tactical 4-Operational | D — 1-Strategic 2-Technical 3-Operational 4-Tactical | The stem never names a taxonomy. Under the widely used strategic/operational/tactical/technical model, the campaign analysis (3) is Operational and the TTP/tooling output (4) is Tactical → D. The PDF's own explanation uses a different mapping → A. |

Recommendation: keep B/Q31, A/Q38, B/Q59, D/Q60 and A/Q63 as scored, but add a short `sourceNote` to each saying the item is taxonomy/tool-variant dependent (or reword the stems to supply the missing definition). Q63 is the one where the common convention actually points to the other option (D).

## App-specific data defects

| Q | Defect | Impact |
|---|---|---|
| **Q20** | Option D is wrong in the app: it says *"Command and control using named pipes"* (copied from Q16's option D). The PDF option D is *"DHCP starvation to exhaust IP leases"*. | Key C (ARP spoofing) is still correct, but the distractor set is corrupted and D duplicates another question's option. Should be fixed. |
| **Q80** | Options C "Demilitarized Zone" and D "Perimeter Network" are synonyms — both are correct names for the segment. | A user choosing D is scored wrong even though it is a valid term. Key C is the canonical name; replace D with a genuinely wrong distractor. |
| **Q61** | Option C reads `netstat -In | egrep "tcp | udp"` — malformed (likely extraction corruption of the original command). | Answer C is still best by elimination (A omits TCP/UDP, B uses the banned `ss`, D needs root + capture), but the option text is not a valid command. |
| **Q77** | No printed key in the PDF; app infers **C — Anomaly-based**. | Inference is correct (statistical improbability vs the customer's own baseline, not a known-bad list) and already documented via `sourceNote` / `answerStatus: "inferred"`. No action needed. |

## Minor observations (not scoring errors)

- **Q1** — key B (initiate containment) is right; A (escalate internally) is also defensible for an L2 analyst.
- **Q10** — printed key text names *"Subject Matter Expert/Threat Hunter"*, which covers options B and D; keyed B is the intended answer.
- **Q39** — the DBA bullet inverts SQL Server recovery semantics ("recovered uncommitted transactions and rolled back failed ones"; committed are rolled forward, uncommitted rolled back). Answer D is unaffected.
- **Q49 vs Q63** — inconsistent taxonomy: Q49 treats hashes as computed IOCs, Q63's explanation calls IPs/domains/hashes "atomic".
- **Q54** — stem implies push-based TAXII subscription; TAXII 2.x is REST/poll-based (push was TAXII 1.1). Key C unaffected.
- **Q35** — stem asks for a "set of logging types" but the options are single log categories; wording only.
- **Q58** — key C (detection scalability) is defensible; A (alert volume reduction) is also arguable from the scenario's opening.
- **Q66, Q67, Q68, Q70** — the other Windows event-ID questions are correct (4608 startup, 4609 shutdown, 4616 time change, 4104 script-block logging).

## Recommended fixes, in priority order

1. **Q16** — change `answer` D → **C**; rewrite `sourceNote` to say the PDF printed D but its explanation/TTPs support C, and that the simulator now scores C.
2. **Q69** — change `answer` D → **C**; add a `sourceNote` explaining 4616 vs 4618.
3. **Q20** — change option D text to *"DHCP starvation to exhaust IP leases"*.
4. **Q80** — replace option D "Perimeter Network" with a genuinely wrong distractor (C stays the answer).
5. Optional polish: fix/replace Q61 option C; add `sourceNote` to Q31/Q38/Q59/Q60/Q63; correct the Q39 stem bullet.
6. After edits: `npm run validate:questions`, rebuild, redeploy.

Items 1–3 change scored answers or displayed content. Items 4–5 are quality fixes that do not change any correct outcome.

## Caveats

- The verdicts are expert judgement, not an authoritative answer key. The source PDF is a third-party compilation and the CSA/EC-Council wording of some taxonomy questions is school-specific.
- 42 of the 79 keys carry explanatory key text that confirms the letter; the other 37 were judged from the question content alone.
- The two "wrong" findings are high confidence; the five "ambiguous" findings are judgement calls about question quality, not claims that the keyed answer is indefensible.

## Follow-up decisions (Round 2)

The five ambiguous items were reviewed with the user, item by item. This supersedes the "Recommendation" line in the ambiguity table above.

| Q | Original advice | Final decision | Basis |
|---|---|---|---|
| Q31 | retain B (Event) | **scored C (Alert)** | The SIEM flags the activity and a ticket is opened — rule-matched activity under triage is an alert. It is not an incident. |
| Q38 | retain A (Setup) | **scored D (System)** | Enabling RDP is a service state change recorded by SCM in the System log; Setup records role/feature installation. The stem explicitly says "enabling services". |
| Q59 | retain B (NetFlow) | **scored A (IPFIX)**, stem repaired | The original stem gave no differentiator. A requirement was added: "Use an IETF standards-track flow-export specification rather than a vendor-proprietary format", which makes IPFIX the only correct answer. |
| Q60 | retain D, ambiguous | **retained D**; option C restored to **"DNS Spoofing"** | The PDF's own explanation discusses DNS Spoofing (which was not among the options), and the compiled option C "DNS blacklisting" was a near-synonym of the answer. Restoring Spoofing makes exactly one mitigation correct. |
| Q63 | retain A | **scored D** | Under the standard strategic/operational/tactical/technical taxonomy, the campaign analysis is operational and the TTP/tooling output is tactical. The PDF's own definitions are non-standard. |
