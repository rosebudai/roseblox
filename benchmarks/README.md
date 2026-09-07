# Browser evaluation

These scripts evaluate already generated games. They do not invoke models, decide which model Rosie routed to, or submit fabricated successful runtime checks. Run them in a development workstation with the repository's Playwright dependency and Chromium installed.

`cases.json` freezes two small 3D game prompts and two follow-up edits per game. Each prompt names visible HUD controls and a deterministic layout so the same input replay can be used for a paired baseline/Roseblox comparison. The scope is deliberately narrow; these cases do not establish general 3D game quality.

Create-flow completion, browser readiness, observable requested behavior, visual assessment and edit regressions are separate outcomes. A pass requires every required check. A screenshot changing, an LLM operation completing, a HUD claiming a win, or a WebGL draw by itself cannot establish playable success. Screenshots and real browser diagnostics are retained in each run directory. `ungraded` means evidence is insufficient; `error` means the evaluator could not complete reliably. Failed required behavior is `fail`.

## Generate and evaluate

The Gateway generation harness consumes the exported JSONL. Regenerate it after changing a case:

```bash
node benchmarks/export-prompts.mjs benchmarks/generation-prompts.jsonl
```

Keep the prompts and manifest fixed before comparing model/engine arms, and retain the source revision and complete manifest for each sample. Prefer a retained playable export with `--artifact` for historical evidence. URL evaluation requires a playable page; an ordinary revision preview URL is not evidence of an immutable game:

```bash
node benchmarks/evaluate.mjs \
  --manifest benchmarks/cases.json --case coin-course --stage create \
  --url http://localhost:3000/generated-game/index.html \
  --output benchmark-results/coin-course/create \
  --metadata generation-metadata.json

node benchmarks/evaluate.mjs \
  --manifest benchmarks/cases.json --case coin-course --stage restart-edit \
  --url http://localhost:3000/edited-game/index.html \
  --output benchmark-results/coin-course/restart-edit \
  --previous benchmark-results/coin-course/create/report.json \
  --metadata edit-metadata.json
```

For exported game files use `--artifact /path/to/game` instead of `--url`. The evaluator serves that directory on an ephemeral loopback port, prevents path escape, and stops the server afterward. The default entry is `index.html`; set `entry` in a case for a different entry. Output directories containing a report cannot be reused. `--browser-executable /usr/local/bin/chromium` selects workstation Chromium; `--headed true` enables a visible browser if the workstation supports one.

Optional generation metadata is copied as evidence supplied by the caller:

```json
{
  "arm": "roseblox",
  "requestedModel": "sol",
  "observedModel": "actual-provider-model-id",
  "modelEvidence": "trace-or-generation-manifest-path",
  "projectId": "project-id",
  "revisionId": "immutable-revision-id",
  "engineRevision": "git-sha",
  "sample": 1
}
```

The browser does not verify these metadata fields. Summaries group the observed model only when the caller supplied both an observed name and evidence reference; a requested model is always kept separate. Real provider costs and generation latency belong to the generation manifest. `durationMs` in the browser report is browser-evaluation time.

## Observable criteria and review

Each checkpoint captures the full viewport, selected canvas, actual WebGL draw counts and visible DOM values needed by assertions. Numeric assertions require exactly one number in the visible text; ambiguous values remain ungraded. Replays use real mouse and keyboard input. No engine state is injected or read as a substitute for observable gameplay.

Clicks on an element that currently owns pointer lock use mouse down/up without repositioning the cursor. Moving to the center of a locked canvas would rotate FPS mouse-look before firing and invalidate the replay. An explicit click `position` still requests positioning; use `move` to exercise deliberate aiming. Reports retain the actual pointer-lock element at each checkpoint and identify clicks that preserved the locked pointer.

Supported actions are `click` (selector or viewport coordinates), `press`, `hold` (one key or `keys` array), `move`, `wait`, and `checkpoint`. Supported assertions are `visible`, `text` and `visible-text` (`equals` or `matches`), `number` and `number-delta` (`equals`, `min`, `max`). `number-delta` needs an earlier `from` checkpoint. `loaded` and `final` are automatic. Cases can specify `frameSelector` for an iframe. Stage `extends` reuses earlier stage replay/checks to preserve behavior through sequential edits.

`text` uses the selected element's ordinary rendered innerText. `visible-text` filters descendant text using effective CSS visibility, ancestor display/opacity, and nonzero text rectangles intersecting the viewport. It excludes opacity-zero banners that innerText would still include, while allowing a descendant to restore inherited CSS visibility. Both store their observations in the report. The win assertions use `visible-text` over `body` because the prompts require visible win text without prescribing which HUD element contains it. This filter does not prove readability, absence of occlusion, or arbitrary clipping; required screenshot review must still fail obscured or unreadable HUD content.

Required visual criteria start ungraded. Review the actual saved screenshots and game/source when needed; if the available evidence cannot establish a criterion, leave it ungraded. For example, screenshots alone may not distinguish gallery raycasting from a fake counter that increments on every click. Additional miss-input replay or source inspection is needed before deciding that criterion. Do not guess from the score.

Apply a review only after examining this run. Every decision needs a rationale and screenshot references from that exact report:

```json
{
  "runId": "copy-the-report-run-id",
  "reviewer": "human:name-or-model:actual-model-id",
  "criteria": [
    {
      "id": "visual.3d-scene",
      "status": "pass",
      "reason": "Describe the visible evidence actually inspected.",
      "evidence": ["loaded.png", "moving.png", "collected.png"]
    }
  ]
}
```

```bash
node benchmarks/evaluate.mjs \
  --report benchmark-results/coin-course/create/report.json \
  --apply-review review.json
```

For edits include `--previous` pointing to the previous **reviewed** report so regression status is recomputed. Prior passing required check IDs are matched to current check IDs. A missing/unknown current result is ungraded, never a regression-free pass. A retained behavior failing is a regression. New edit criteria must also pass for the edit to pass. Keep review files alongside reports for provenance.

Console, page errors, failed requests and HTTP errors remain visible in JSON. Console errors fail by default; an automatic failed `/favicon.ico` request is retained with an explicit exclusion reason because it is not a game asset. `failOnConsoleError: false` can make console errors diagnostic for a case, but that configuration must be fixed before the experiment. The WebGL probe cannot grade OffscreenCanvas worker rendering or WebGPU. It also cannot determine whether drawn content fulfills the game prompt.

## Metrics and verification

```bash
node benchmarks/summarize.mjs benchmark-results/*/*/report.json --output benchmark-results/summary.json
node --test benchmarks/*.test.mjs
ROSEBLOX_BROWSER_TEST=1 node --test --test-concurrency=1 benchmarks/*.test.mjs
```

The summary reports confirmed success across all browser runs, success among graded runs, grading coverage, and edit regression counts. Zero graded runs produce a null graded success rate. It rejects duplicate run IDs. It cannot count generation attempts that never produced a browser report; join the generation manifest to retain those failures in the overall create-flow denominator. Use multiple paired samples before claiming that Roseblox improves success, latency or cost.

The real-browser contract test draws a synthetic WebGL triangle and responds to input to verify the evaluator, then verifies that a blank canvas cannot pass. The visible-text contract test also checks transparent, hidden, zero-size, offscreen, and revealed text in actual Chromium. Browser tests run sequentially to avoid shared software-renderer interference. Set `ROSEBLOX_VISIBLE_TEXT_CALIBRATION_ROOT` to a fresh path to retain that test's fixture, screenshots, and observations; otherwise it uses and removes a temporary directory. These are assistant-authored evaluator calibrations, not Rosie generation results or evidence of model quality.

Two maintained assistant-authored fixtures exercise the actual game replays, including their follow-up edit stages:

```bash
node benchmarks/calibrate-coin-course.mjs /tmp/roseblox-coin-calibration
node benchmarks/calibrate-target-gallery.mjs /tmp/roseblox-gallery-calibration
```

Use fresh output directories and run these inside the workstation. The coin fixture uses Roseblox movement and pickups. The gallery fixture uses actual Three.js raycasting, pointer lock and mouse-look, then validates three targets, five targets, restart with five more hits, and a deliberate miss that must not increase the score. Its Start and Restart buttons sit away from canvas center so unintended pointer movement during clicks is caught. Each fixture runs through the real evaluator and its own temporary artifact server, retaining screenshots and reports under the supplied output directory.

These fixtures are assistant-authored calibration, not Rosie generation samples. Their runs use no Rosie operations or Rosie provider calls. They test the evaluator and engine contracts; exclude them from Rosie generation metrics. Their visual-review status remains ungraded until someone supplies an actual review, even when the replay assertions pass.
