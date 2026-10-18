/**
 * Decide, from the request alone, whether the provider is about to receive a
 * tool list in which **every** entry is deferred.
 *
 * ## Why the request cannot simply be inspected
 *
 * The shape that fails is not the shape the waterfall sees. A loop-built request
 * carries the session's *declarations* and the folded tool history; the adapter
 * receives the projections of those, built later, inside the runtime:
 *
 * ```ts
 * // packages/llm/llm/src/index.ts, adapterStream()
 * const projectedTools = projectToolUpdates(
 *   projectedMessages, resolvedOptions.tools, modelInfo.toolUpdate, resolvedOptions.toolHistory)
 * ```
 *
 * `projectToolUpdates` (packages/llm/llm/src/content.ts) resolves the folded
 * history into declarations — the baseline plus additions, and every addition
 * carries `deferLoading: true` — and then applies the route's update mode:
 *
 * | mode | what reaches the provider |
 * |---|---|
 * | `addition-only` | those declarations **filtered down to the active tool names** |
 * | `in-history` | those declarations, unfiltered |
 * | absent | the declaration list with every `deferLoading` flag stripped |
 *
 * The reported failure is the `addition-only` case (`llm-deepseek`'s catalog
 * declares it at packages/llm/llm-deepseek/src/models.ts:13): the only tool that
 * was available from the start has been removed by a `tool-removal` block, every
 * surviving tool came in as an addition, and so every surviving tool is
 * deferred.
 *
 * ## What this module computes instead
 *
 * The same conclusion, without reproducing the projection: a wire entry is
 * non-deferred exactly when its name was already declared, non-deferred, in the
 * baseline `toolHistory.tools`. So
 *
 * - `addition-only` is all-deferred when **no active tool name** appears among
 *   those baseline names;
 * - `in-history` is all-deferred when that baseline name set is **empty**.
 *
 * Both are one set operation over data the request already carries, and neither
 * depends on knowing which mode the route declared — which is the one fact the
 * waterfall cannot see, because it is resolved per model by an adapter this
 * listener never touches.
 *
 * @module @argszero/dsh-all-deferred-tools-guard/verdict
 */
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm';
/** Which reading produced the verdict. */
export type VerdictReason = 
/** The declaration list itself is entirely deferred — `defer_loading` with no history at all. */
'declarations'
/** No baseline declaration is usable, so both history-backed modes project to all-deferred. */
 | 'history'
/** Baseline declarations exist but none of them is active; `addition-only` filters them all out. */
 | 'active-new-only'
/** Nothing to fix. */
 | 'none';
/** What one request looks like to this guard. */
export interface Verdict {
    /** Whether the provider is about to be sent a tool list with no loadable entry. */
    readonly allDeferred: boolean;
    /** Which reading produced {@link allDeferred}. */
    readonly reason: VerdictReason;
    /** Active tool declarations the request carries. */
    readonly toolCount: number;
}
/**
 * Whether any developer message carries a tool addition or removal block.
 *
 * A request outside the tool-update regime cannot produce the all-deferred wire
 * shape by construction — with no updates, the projection has nothing to mark
 * deferred — so every reading below is gated on this.
 * @param messages - the request's messages.
 * @returns whether the tool-update regime is in play.
 */
export declare function hasToolUpdates(messages: readonly RequestMessage[]): boolean;
/**
 * Read one request without changing it.
 * @param options - the request as it reaches the waterfall.
 * @returns the verdict, and which reading produced it.
 */
export declare function inspect(options: GenerateOptions): Verdict;
//# sourceMappingURL=verdict.d.ts.map