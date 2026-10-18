/**
 * The listener: predict when possible, and let the provider be the last word
 * when prediction is not certain.
 *
 * ## Why a listener at all
 *
 * A plugin cannot patch the DeepSeek adapter — `registerAdapter` is
 * all-or-nothing per provider route (packages/llm/llm/src/index.ts:401), and a
 * second registration for the same route is `DUPLICATE_ADAPTER`. What it can do
 * is sit in front of the dispatch, because `llm/stream` is a waterfall whose
 * listener sees the whole request and may return a stream of its own.
 *
 * ## Why it re-dispatches
 *
 * A loop-built request arrives deep-frozen — the waterfall's contract is that its
 * content is a pure function of the session log — and `next()` takes no argument.
 * The only way to hand the adapter a different request is to ask the runtime for
 * a stream of that request (`ctx.llm.stream(replacement)`), which re-enters this
 * same waterfall. Identity is what stops the recursion: every replacement this
 * plugin builds is recorded in a `WeakSet`, and a recorded request goes straight
 * to `next()`.
 *
 * ## Two triggers, in this order
 *
 * 1. **Predicted.** {@link inspect} computes, from the request itself, whether
 *    the adapter's projection can only be all-deferred. This costs a set
 *    operation and never touches the network, and it is what makes a session
 *    that is already poisoned usable again on its very next request.
 * 2. **Rejected.** When the request is in the tool-update regime but the
 *    prediction says nothing, the stream is watched until its first chunk. If
 *    that chunk is the provider's own refusal — `at least one tool must have
 *    defer_loading=false. All tools cannot be deferred.` — the attempt is
 *    dropped and the repaired request is dispatched instead. A provider refusing
 *    a request emits no content chunk, so nothing is lost by starting over.
 *
 * The second trigger exists because the prediction cannot see everything: the
 * update mode is resolved per model inside the adapter, and an adapter this
 * plugin has never heard of may mark deferral somewhere else. `llm-retry` does
 * not retry `INVALID_REQUEST`, so the refusal arrives exactly once.
 *
 * ## Fail-open, always
 *
 * A guard that swallowed a working model call would be a worse failure than the
 * one it prevents. Every predicate, every substitution and every re-dispatch runs
 * behind a `try`: on a throw the original request goes to `next()`, a counter
 * moves, and a warning is logged.
 *
 * @module @argszero/dsh-all-deferred-tools-guard/guard
 */
import type { Context } from '@deepseek-ai/cordis';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Verdict } from './verdict.ts';
/** How a repair was decided. */
export type RepairSource = 'predicted' | 'rejected';
/** Where the listener reports what it did. */
export interface GuardPolicy {
    /** When true, everything is decided and counted, and nothing is changed. */
    readonly observe: boolean;
    /** Provider routes the guard applies to; empty means every route. */
    readonly providers: readonly string[];
    /** One request the prediction found all-deferred. */
    readonly onPredict: (verdict: Verdict, provider: string) => void;
    /** One request the provider refused for this reason, whatever happens next. */
    readonly onRefuse: (provider: string) => void;
    /** One request that was actually replaced. */
    readonly onRepair: (source: RepairSource, provider: string) => void;
    /** One predicate, substitution or dispatch failure that was failed open. */
    readonly onFailure: (error: unknown) => void;
}
/** Whether one terminal chunk is the provider refusing an all-deferred tool list. */
export declare function isAllDeferredRejection(chunk: StreamChunk): boolean;
/**
 * Install the guard on the `llm/stream` waterfall.
 *
 * `global` because the stream is dispatched with the registry instance as the
 * listener's `this`, so a mount scoped to a profile must still cover it;
 * `prepend` so this sees the request before any listener that would forward it
 * unchanged.
 * @param ctx - the context to register on.
 * @param policy - where to report.
 */
export declare function installGuard(ctx: Context, policy: GuardPolicy): void;
//# sourceMappingURL=guard.d.ts.map