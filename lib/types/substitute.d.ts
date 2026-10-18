/**
 * Build the request that keeps the deferred tool table legal.
 *
 * ## The repair, and why it is this one
 *
 * The provider refuses a request whose tool list has no entry with
 * `defer_loading: false`, so a legal request needs exactly one such entry. The
 * harness already does this for its own pi-ai routes — when every projected tool
 * is deferred it prepends a reserved placeholder that the model is told never to
 * call:
 *
 * ```ts
 * // packages/llm/llm-pi-ai/src/adapter.ts
 * const ANTHROPIC_TOOL_UPDATE_PLACEHOLDER: ToolSchema = {
 *   name: 'DeferredToolPlaceholder',
 *   description: 'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
 *   parameters: { type: 'object', properties: {} },
 * }
 * ```
 *
 * This plugin introduces **the same tool, name for name**. That is deliberate
 * and it is the whole reason it can run unconditionally: on a route that already
 * guards itself, the guard's own predicate
 * (`tools.every(tool => tool.deferLoading === true)`) is false once this
 * placeholder is in the list, so it adds nothing and the provider receives the
 * request it would have received anyway. A different name would have made the
 * same wire request mean two different things depending on which guard ran
 * first.
 *
 * ## Where the placeholder has to be inserted
 *
 * Not only into `options.tools`. The adapter does not serialize `options.tools`
 * — it serializes the *projection* of it, and in `addition-only` mode that
 * projection is `history.tools ∪ additions`, filtered down to the names present
 * in `options.tools`. So the placeholder has to be in both places, or it is
 * filtered out again:
 *
 * - in `toolHistory.tools`, so it is seeded as a declaration;
 * - in `tools`, so the active-name filter keeps it.
 *
 * In `in-history` mode the `tools` copy is unused (the projection there is
 * unfiltered), and on a route with no update mode both copies are irrelevant
 * because every `deferLoading` flag is stripped — one insertion covers all three
 * readings.
 *
 * ## What is never done here
 *
 * Nothing is mutated: a loop-built request arrives deep-frozen by contract, and
 * this module only ever reads it. The replacement is a fresh object, sharing
 * every unchanged field with the original.
 *
 * @module @argszero/dsh-all-deferred-tools-guard/substitute
 */
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm';
/** The placeholder's wire name — identical to the pi-ai adapter's own. */
export declare const PLACEHOLDER_NAME = "DeferredToolPlaceholder";
/** What the model is told about the placeholder. */
export declare const PLACEHOLDER_DESCRIPTION = "Reserved placeholder that keeps deferred tool loading active; never call this tool.";
/** The placeholder's argument schema: an object that accepts nothing. */
export declare const PLACEHOLDER_PARAMETERS: Readonly<Record<string, unknown>>;
/**
 * One fresh placeholder declaration.
 *
 * A new object each time: the loader may freeze what a plugin hands it, and a
 * shared instance reused across two requests would then be frozen for the
 * second — the class of failure this task's own notes call a deferred poison.
 * @returns a placeholder tool schema.
 */
export declare function placeholder(): ToolSchema;
/**
 * Build the repaired request, or say that none is needed.
 * @param options - the request as it reached the waterfall; never mutated.
 * @returns the replacement request, or `undefined` when the request already
 *   carries a loadable entry, has no tools at all, or has been repaired before.
 */
export declare function substitution(options: GenerateOptions): GenerateOptions | undefined;
//# sourceMappingURL=substitute.d.ts.map