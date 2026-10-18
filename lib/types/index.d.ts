/**
 * A session must stay usable when its tool list happens to become all-deferred.
 *
 * ## The failure
 *
 * `@deepseek-ai/dsh-llm-deepseek` serializes the request's projected tools
 * straight to the Messages endpoint (packages/llm/llm-deepseek/src/serialize.ts),
 * and that endpoint refuses a tool list in which every entry says
 * `defer_loading: true`:
 *
 * ```
 * tools: at least one tool must have defer_loading=false. All tools cannot be deferred.
 * ```
 *
 * The request is not retried — the code is `INVALID_REQUEST`, and retrying would
 * produce the same body — and the shape is a property of the conversation, not of
 * one bad turn, so every following request in that session is refused too. The
 * reported sessions were dead until they were rebound to a model whose catalog
 * entry declares no tool updates, or abandoned.
 *
 * How a session gets there: a tool that was available from the session's first
 * request is removed, and everything that remains arrived as a `tool-addition`.
 * `projectToolUpdates` marks every addition `deferLoading: true` because a later
 * activation is exactly what deferred loading means, and the `addition-only`
 * route then filters the declarations down to the active names — leaving nothing
 * but deferred entries.
 *
 * ## Why it is a plugin
 *
 * `@deepseek-ai/dsh-llm-pi-ai` already answers this shape for its own routes: when
 * every projected tool is deferred it prepends a reserved placeholder that the
 * model is told never to call (packages/llm/llm-pi-ai/src/adapter.ts). The
 * DeepSeek adapter has no equivalent, and a plugin cannot add one inside it —
 * `registerAdapter` is all-or-nothing per provider route and a second
 * registration is `DUPLICATE_ADAPTER`. What a plugin *can* do is put a different
 * request in front of the dispatch, because `llm/stream` is a waterfall.
 *
 * So this plugin does one thing: it makes sure no request it sees carries a tool
 * table with no loadable entry, by inserting the same placeholder the pi-ai
 * adapter inserts. Nothing is written to the session log, nothing is written to
 * disk, and the conversation that was dead becomes usable on its next request.
 *
 * ## What it does not claim
 *
 * - It repairs the **request**, not the cause: the session still holds a tool
 *   history in which every active tool is new, and the placeholder is the only
 *   thing keeping the wire list legal. Fixing the history would be a core change.
 * - The placeholder is a real declaration on the wire. A model that calls it
 *   anyway gets the harness's ordinary "unknown tool" path, because no tool of
 *   that name is registered.
 * - A route that strips `deferLoading` entirely (`toolUpdate` absent) may receive
 *   the placeholder without needing it. That costs one unused definition in the
 *   tool table and nothing else.
 * - It cannot see the route's update mode, so the prediction is a set operation
 *   over the request plus the provider's own refusal as a backstop; see
 *   `guard.ts` for both triggers.
 *
 * @module @argszero/dsh-all-deferred-tools-guard
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config, GuardMode } from './config.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "all-deferred-tools-guard";
/** The service whose dispatch this plugin stands in front of. */
export declare const inject: string[];
/** The name under which the read-only view is provided. */
export declare const SERVICE = "allDeferredToolsGuard";
/** What an operator may read back, and what the plugin will not do. */
export interface Snapshot {
    /** The resolved mode. */
    readonly mode: GuardMode;
    /** Provider routes covered; empty means every route. */
    readonly providers: readonly string[];
    /** Requests the prediction found all-deferred. */
    readonly predicted: number;
    /** Requests the provider refused that the prediction had passed. */
    readonly refusals: number;
    /** Requests actually replaced, by the trigger that decided it. */
    readonly repaired: {
        readonly predicted: number;
        readonly rejected: number;
    };
    /** Predicate, substitution or dispatch failures that were failed open. */
    readonly errors: number;
    /** The properties this plugin does not have, stated where an operator will read them. */
    readonly blindSpots: readonly string[];
}
/** The read-only view this plugin provides. */
export interface AllDeferredToolsGuardService {
    /** A point-in-time copy of the counters. */
    snapshot(): Snapshot;
}
/** The properties this plugin is honest about not having. */
export declare const BLIND_SPOTS: readonly string[];
/**
 * Mount the plugin.
 * @param ctx - the context this plugin is mounted on.
 * @param config - what the operator wrote.
 */
export declare function apply(ctx: Context, config?: Config): void;
export type { Config, GuardMode, Settings } from './config.ts';
export { defaultConfig, MODES, normalizeConfig } from './config.ts';
export { installGuard, isAllDeferredRejection } from './guard.ts';
export type { GuardPolicy, RepairSource } from './guard.ts';
export { PLACEHOLDER_DESCRIPTION, PLACEHOLDER_NAME, PLACEHOLDER_PARAMETERS, placeholder, substitution } from './substitute.ts';
export { hasToolUpdates, inspect } from './verdict.ts';
export type { Verdict, VerdictReason } from './verdict.ts';
/**
 * The object a loader entry mounts: the loader normalises a plugin module with
 * `exports.default ?? exports` and hands this to `ctx.plugin`.
 *
 * Deliberately no `Config` key — see the note in `config.ts`.
 */
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map