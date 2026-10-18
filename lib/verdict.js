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
/** Content block types that put a request into the tool-update regime. */
const TOOL_UPDATE_BLOCKS = new Set(['tool-addition', 'tool-removal']);
/** Whether one tool opts into deferred loading. */
function deferred(tool) {
    return tool.deferLoading === true;
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
export function hasToolUpdates(messages) {
    return messages.some(message => message.role === 'developer'
        && message.content.some(block => TOOL_UPDATE_BLOCKS.has(block.type)));
}
/**
 * The names a projection can still offer as declared-and-loadable.
 *
 * `toolHistory.tools` is "complete active declarations at the start of this
 * history" (packages/llm/llm/src/types.ts): the only definitions that reach the
 * provider without `defer_loading`. An entry that already carries
 * `deferLoading: true` there is deferred baseline — the projection documents
 * that it "become[s] available only after [its] first retained addition".
 * @param history - the folded tool history.
 * @returns the baseline names that serialize without `defer_loading`.
 */
function baselineNames(history) {
    const names = new Set();
    for (const tool of history.tools)
        if (!deferred(tool))
            names.add(tool.name);
    return names;
}
/**
 * Read one request without changing it.
 * @param options - the request as it reaches the waterfall.
 * @returns the verdict, and which reading produced it.
 */
export function inspect(options) {
    const tools = options.tools ?? [];
    if (tools.length === 0)
        return { allDeferred: false, reason: 'none', toolCount: 0 };
    if (tools.every(deferred)) {
        // Nothing in the declaration list is loadable, so no projection of it can be.
        return { allDeferred: true, reason: 'declarations', toolCount: tools.length };
    }
    const history = options.toolHistory;
    if (history === undefined || !hasToolUpdates(options.messages)) {
        return { allDeferred: false, reason: 'none', toolCount: tools.length };
    }
    const baseline = baselineNames(history);
    if (baseline.size === 0) {
        return { allDeferred: true, reason: 'history', toolCount: tools.length };
    }
    const active = new Set(tools.map(tool => tool.name));
    for (const name of baseline) {
        // One active name that was declared before the history is enough for
        // `addition-only`; an unfiltered `in-history` projection keeps the rest.
        if (active.has(name))
            return { allDeferred: false, reason: 'none', toolCount: tools.length };
    }
    return { allDeferred: true, reason: 'active-new-only', toolCount: active.size };
}
