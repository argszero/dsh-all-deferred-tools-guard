# @argszero/dsh-all-deferred-tools-guard

A dsh session stays usable when its tool table becomes entirely deferred.

## The failure

`@deepseek-ai/dsh-llm-deepseek` sends the request's projected tools straight to
the Messages endpoint. That endpoint refuses a tool list in which **every** entry
says `defer_loading: true`:

```
tools: at least one tool must have defer_loading=false. All tools cannot be deferred.
```

The code is `INVALID_REQUEST`, so `llm-retry` does not retry it, and the shape is
a property of the conversation rather than of one turn — every later request is
refused the same way and the session is dead. Reported on dsh desktop 0.2.1-rc.2
in [discussion #10163](https://github.com/deepseek-ai/deepseek-harness/discussions/10163):
four sessions, and the workarounds were to rebind the conversation to a model
whose catalog entry declares no tool updates, or to abandon it.

How a session gets there. A loop-built request carries the session's declarations
and its folded tool history; the runtime projects them before the adapter sees
them (`packages/llm/llm/src/index.ts`, `adapterStream`), and
`projectToolUpdates` marks every tool-addition `deferLoading: true` — a tool that
arrives later is by definition loaded later. `llm-deepseek` declares
`toolUpdate: 'addition-only'` (`packages/llm/llm-deepseek/src/models.ts:13`),
which filters the declarations down to the active tool names. So when the one
tool that was available from the session's first request is removed — in the
report, a PTC `run_code` that a resume stopped applying and a native presentation
of 67 tools replaced — everything that survives arrived as an addition, and every
surviving entry is deferred.

`@deepseek-ai/dsh-llm-pi-ai` already answers this shape for its own
`anthropic-messages` routes by prepending a reserved placeholder the model is
told never to call. The DeepSeek adapter has no equivalent, and a plugin cannot
add one inside it: `registerAdapter` is all-or-nothing per provider route, and a
second registration is `DUPLICATE_ADAPTER`.

## What this plugin does

It puts a different request in front of the dispatch. `llm/stream` is a
waterfall, so a listener sees the whole request before the adapter does, and when
the request can only project to an all-deferred list the listener re-dispatches a
replacement that carries **the same placeholder the pi-ai adapter uses** —
`DeferredToolPlaceholder`, same description, empty object schema, not deferred.

Two triggers, because the projection happens after the waterfall:

1. **Predicted.** A wire entry is loadable exactly when its name was already
   declared, non-deferred, in `toolHistory.tools`. So "no active tool was
   available from the start" is a set operation over the request, needs no
   knowledge of the route's update mode, and costs no network round trip. This is
   what makes an already-poisoned session usable on its very next request.
2. **Rejected.** When the prediction is silent but the request is in the
   tool-update regime, the first chunk of the stream is examined. The provider's
   own refusal — the sentence quoted above — is answered by dispatching the
   repaired request. A refused request emits no content chunk, so nothing is
   lost by starting over, and `INVALID_REQUEST` is not retried, so the refusal
   arrives exactly once.

Nothing is written to the session log and nothing is written to disk: the request
is repaired, not the history that produced it.

## Install

The git form works today; the npm publication is pending a registry token, and
the package name is reserved against `@argszero` until it lands:

```sh
npm install github:argszero/dsh-all-deferred-tools-guard
# once published:
npm install @argszero/dsh-all-deferred-tools-guard
```

Then mount it — a profile overlay, or the `insert` block this package's own
`cordis.patch.yml` carries:

```yaml
- insert:
    - id: all-deferred-tools-guard
      name: '@argszero/dsh-all-deferred-tools-guard'
      config:
        mode: guard
```

## Configuration

| key | default | meaning |
|---|---|---|
| `mode` | `guard` | `guard` repairs the request; `observe` decides and counts and changes nothing; `off` installs no listener. |
| `providers` | `[]` | Provider routes to cover, matched exactly. Empty means every route — the shape is decided by a projection this plugin cannot see, so covering everything is the point. |
| `report` | `true` | One `debug` line per decision, warnings and the mount summary at `info`. |

An unknown `mode` is refused by name at mount rather than silently treated as
`guard`.

`{{allDeferredToolsGuard}}` serves `snapshot()`:

```json
{
  "mode": "guard",
  "providers": [],
  "predicted": 3,
  "refusals": 1,
  "repaired": { "predicted": 3, "rejected": 1 },
  "errors": 0,
  "blindSpots": ["..."]
}
```

`predicted` counts requests the first trigger read as all-deferred; `refusals`
counts requests the provider refused for this reason, whatever happened next;
`repaired` counts only replacements that were actually dispatched, so `observe`
mode shows a decision with no repair.

## What it does not claim

- It repairs the **request**, not the cause. The session still holds a tool
  history in which every active tool arrived as an addition, and the placeholder
  is what keeps the wire list legal. Fixing the history would be a core change.
- The placeholder is a real declaration on the wire. A model that calls it
  reaches the harness's ordinary unknown-tool path, because nothing registers a
  tool of that name — the same trade the pi-ai adapter makes.
- It cannot read the route's update mode (that is resolved per model inside the
  adapter), so the prediction is an over-approximation and the provider's refusal
  is the backstop.
- A route that strips `deferLoading` entirely (`toolUpdate` absent) may receive
  the placeholder without needing it. That costs one unused definition in the
  tool table and nothing else.
- It fails open. A predicate, substitution or dispatch failure dispatches the
  original request unchanged, counts the error and logs a warning: a guard that
  swallowed a working model call would be worse than the failure it prevents.

## Verification

```sh
npm test           # 38 tests: predicate, substitution, listener, peer range
npm run test:inject    # 8 mutation arms, each must turn the suite red
node scripts/probe-lines.mjs   # the shipped projection, on released lines
```

The suite's claims are three:

- **The predicate reads the reported request correctly.** Built from the report —
  a baseline `run_code`, 67 additions, one removal, the PTC `run_code` no longer
  active — it returns `active-new-only`.
- **The repair produces a legal list under the harness's own code.**
  `scripts/probe-lines.mjs` calls the real `projectToolUpdates` from the shipped
  `@deepseek-ai/dsh-llm` on each installed line and asserts both halves: the
  original request projects to 67 tools with every entry deferred, and the
  repaired request projects to 68 with exactly one loadable. Measured on
  `0.2.0-rc.2` and `0.2.1-rc.2`.
- **Both semver readings agree about the peer range.** One range, two consumers:
  the harness's compatibility gate reads it with `includePrerelease: true`, npm
  reads it with the default options and answers `ERESOLVE` when the sets differ.
  The test asserts the two readings admit exactly the same versions, which is why
  every segment's upper bound is written `<x.y.z-0` rather than `<x.y.z`.

The plugin has no runtime dependencies and imports no harness package for value —
only types — so a `profile` deployment cannot materialize a second copy of a
harness package.

## Licence

MIT.
