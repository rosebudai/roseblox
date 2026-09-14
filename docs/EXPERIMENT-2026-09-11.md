# Adapter experiment: prompt interference and racing controls

Status: draft experiment; application routing is unchanged. The controller implementation is commit `60846d57e18ea6c5877cb293156b793db93dd08f`. See the [public comparison and preserved originals](https://roseblox-three-way-review.pai286861.chatgpt.site/) and its [detailed findings](https://roseblox-three-way-review.pai286861.chatgpt.site/report.md).

## The earlier comparison was confounded

The experiment sidecar replaced the processor constructor's `system_prompt`, but Gateway `ContextBuilder.build_oneshot_context()` independently populated `context.oneshot_system_prompt`. `OpenAIAgenticProcessor._prepare_context_for_llm()` prefers the context-owned prompt. As a result, the smaller mechanics runtime was paired with the legacy full-engine prompt, not the intended normal Rosebud art policy plus a mechanics instruction.

Actual provider-input observations from an RPG adapter create and an earlier Orbital Depot repeat contain the legacy engine-first block, usual 1–2-model guidance and three/four-material palette. They do not contain the intended `<mechanics_library>` instruction. The sampled normal control has neither restriction.

The earlier 10.5% lower main-model cost and 47.7% higher total tokens are valid accounting for the observed compound treatment. They do not isolate an adapter effect. The previous constructor-level audit verified the wrong value. Cache reads explain the accounting discrepancy, but do not establish that savings persist after the art-policy correction. Runtime JavaScript is marked `in_llm_context=False`; API guidance is injected separately. Aggregate tokens include repeated cached context across turns and are not a direct measure of engine source size.

## Corrected experiment request construction

The experiment sidecar now replaces the prompt at the context builder and checks the prepared system immediately before every streamed model turn. This is an experiment-only correction, not a change to Gateway's intentional prompt precedence or production model routing.

The zero-provider-call regression check uses the actual processor context preparation:

```python
# context.oneshot_system_prompt starts with the legacy prompt.
processor.system_prompt = expected_normal_plus_adapter_prompt
broken = await processor._get_prepared_context(context)
assert broken.system != expected_normal_plus_adapter_prompt

context.oneshot_system_prompt = expected_normal_plus_adapter_prompt
context.bump_version()
prepared = await processor._get_prepared_context(context)
assert prepared.system == expected_normal_plus_adapter_prompt
```

The streaming wrapper repeats the exact prepared-system assertion before calling the original `stream_turn`, records its hash and reasoning effort by create, and aborts before the provider call if it fails. Component guide hashes, supplied runtime hashes, selected Rosie model, resolved GPT Sol model, medium reasoning and frozen Gateway inventory are verified independently. Retrieved provider-input observations corroborate the request-boundary audit.

The original non-FPS batch stopped after 12 model-started creates. Four unstarted slots were reassigned to two corrected RPGs and two corrected racers, reusing the first two saved normal controls and the exact saved expansions for each genre. Total new model-started creates remains 16. The original four-per-cell clean comparison is incomplete. Earlier outputs are preserved and labeled; no post-generation repairs, active-play feedback or replacement creates were added.

RPG keeps the generic adapter guide unchanged. Racing adds the new vehicle API guide and implementation, so its follow-up changes both prompt wiring and controls. Two corrected samples per genre cannot establish statistical superiority or an isolated cost effect.

## Corrected result snapshot

All four corrected creates finish with clean startup checks. All 27 streamed model turns pass the effective-system assertion, and retrieved provider inputs from all four creates confirm the intended instruction without the legacy asset budgets. Both racers use `addArcadeVehicle()`; neither writes player propulsion directly.

| Two samples per branch | Normal mean time | Adapter mean time | Normal mean main-model cost | Adapter mean main-model cost |
| --- | ---: | ---: | ---: | ---: |
| RPG | 3m 14s | 4m 46s | $0.3426 | $0.4460 |
| Racing | 3m 37s | 3m 47s | $0.4036 | $0.3588 |

The four corrected creates use 814,603 main-model tokens, $1.6096 main-model reported cost and $2.5086 traced workflow usage; wall time is 17m 20s. Original-create internal authoring and finish-check corrections are included. No new expansion calls were made. Reported usage excludes Runpod reconstruction, infrastructure and Codex work and is not reconciled cash expense.

Both corrected RPGs generate six model subjects, two surface textures and a skybox, compared with the old treatment's 2.5 models per RPG on average. Distinct model planning returns, but visual quality remains uneven: incomplete placeholder replacement, road mesh/collider shape or height disagreement and unintegrated generated props are still present. Both racers' game-owned state machines ignore `car.active` on focus loss, allowing the clock to continue when input pauses. Full quest/race acceptance and semantic model-front orientation are unverified. The small sample and racing API change preclude an isolated cost/quality-effect claim.

## Racing controller

`mechanics.addArcadeVehicle()` supplies an upright dynamic chassis, CCD, acceleration, brake-before-reverse, speed-dependent steering, directional tire grip and handbrake drift. Four collision-filtered ground probes support flat tracks and gentle ramps. Solver velocity is the source of truth; vertical momentum is preserved and airborne cars receive no engine propulsion.

An optional camera follows the interpolated chassis and uses a segment obstruction query. Canvas-scoped keyboard controls support focus, pause/resume and reset without pointer lock. Analog inputs support AI or custom UI. The game owns the renderer, car models, tracks, race rules, effects and HUD. This is not a suspension, banked-track or rollover simulator.

See [the API guide](MECHANICS.md) and [the authored example](../examples/racing/). The example is a controller fixture, excluded from one-shot metrics.

Validation: 162 engine tests pass, including eight vehicle tests for clock independence, forward/reverse steering, braking, drift, collision, sensors, airborne behavior, ramps, collision-filtered probes, input focus, quick Escape, reset, cleanup and camera obstruction. Build passes. Bounded Chrome checks verify entry, acceleration/movement, reset and quick Escape pause; they do not claim full-lap acceptance.

## Remaining quality risks

The prompt's asset policy is a concrete source of interference. The original RPG controls generated 21 model subjects and four textures, versus ten models and twelve textures in the legacy-prompt treatment. All eight used skyboxes. This is consistent with changed art planning before the runtime renders anything.

Separate generated-code issues include incorrect camera-relative movement signs, negative camera height, feet-normalized art bound at collider centers, and unsupported jump integration. The adapter does not own the renderer, materials or lighting; it does own the world pose of bound roots. Correct root/child offsets and animation ownership remain real integration concerns. Asset counts and clean startup checks are not aesthetic or full-gameplay scores.

Keep the normal art policy while evaluating the narrower mechanics contract. The generic `addCharacter()` handle has no public jump action; only FPS input supplies `jumpDown` and `jumpSpeed` to the shared motor. A one-frame Y velocity does not create sustained jump momentum, making generic character jumping an adapter API gap as well as a generation-integration risk. Investigate third-person root/feet placement and a supported jump action separately; do not add a new visual quota based on the confounded data.
