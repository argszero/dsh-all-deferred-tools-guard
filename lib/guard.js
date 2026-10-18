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
import { substitution } from "./substitute.js";
import { hasToolUpdates, inspect } from "./verdict.js";
/**
 * The provider's own words, in both spellings observed in the wild: the DeepSeek
 * Messages endpoint prefixes the sentence with the request field it is about.
 */
const REJECTION = /at least one tool must have defer_loading=false|all tools cannot be deferred/i;
/** Whether one terminal chunk is the provider refusing an all-deferred tool list. */
export function isAllDeferredRejection(chunk) {
    if (chunk.type !== 'finish')
        return false;
    const reason = chunk.reason;
    if (reason.kind !== 'error')
        return false;
    return REJECTION.test(reason.failure.message);
}
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
export function installGuard(ctx, policy) {
    const dispatched = new WeakSet();
    const applies = (options) => policy.providers.length === 0 || policy.providers.includes(options.provider);
    const repair = (options, source) => {
        const replacement = substitution(options);
        if (replacement === undefined || policy.observe)
            return undefined;
        policy.onRepair(source, options.provider);
        // Recorded before the call: the re-dispatch re-enters this listener.
        dispatched.add(replacement);
        return ctx.llm.stream(replacement);
    };
    ctx.on('llm/stream', (options, next) => {
        if (dispatched.has(options) || !applies(options))
            return next();
        let verdict;
        try {
            verdict = inspect(options);
        }
        catch (error) {
            policy.onFailure(error);
            return next();
        }
        if (verdict.allDeferred) {
            policy.onPredict(verdict, options.provider);
            try {
                const repaired = repair(options, 'predicted');
                if (repaired !== undefined)
                    return repaired;
            }
            catch (error) {
                policy.onFailure(error);
            }
            return next();
        }
        // The prediction is silent, but the request is in the regime where the wire
        // shape is decided by a projection this listener cannot compute. Watch it.
        try {
            if (options.toolHistory === undefined || !hasToolUpdates(options.messages))
                return next();
        }
        catch (error) {
            policy.onFailure(error);
            return next();
        }
        // `next()` is called here, not inside the generator: the waterfall's other
        // listeners expect to be reached at dispatch time, not at first pull.
        return watch(options, next(), repair, policy);
    }, { global: true, prepend: true });
}
/** Iterate a stream, and forward everything but a refusal that a repair can answer. */
async function* watch(options, upstream, repair, policy) {
    const iterator = upstream[Symbol.asyncIterator]();
    let exhausted = false;
    try {
        const first = await iterator.next();
        if (first.done) {
            exhausted = true;
            return;
        }
        if (!isAllDeferredRejection(first.value)) {
            yield first.value;
            while (true) {
                const step = await iterator.next();
                if (step.done) {
                    exhausted = true;
                    return;
                }
                yield step.value;
            }
        }
        let repaired;
        try {
            policy.onRefuse(options.provider);
            repaired = repair(options, 'rejected');
        }
        catch (error) {
            policy.onFailure(error);
        }
        if (repaired === undefined) {
            // Observe mode, or a request that already carries the placeholder: the
            // provider's own answer is the honest one and it is forwarded untouched.
            yield first.value;
            return;
        }
        exhausted = true;
        // The refused attempt produced one chunk and no content; the replacement
        // starts from the same conversation state.
        yield* repaired;
    }
    finally {
        if (!exhausted)
            await iterator.return?.(undefined);
    }
}
