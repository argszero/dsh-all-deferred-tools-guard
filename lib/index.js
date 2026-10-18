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
import { defaultConfig, normalizeConfig } from "./config.js";
import { installGuard } from "./guard.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'all-deferred-tools-guard';
/** The service whose dispatch this plugin stands in front of. */
export const inject = ['llm'];
/** The name under which the read-only view is provided. */
export const SERVICE = 'allDeferredToolsGuard';
/** The properties this plugin is honest about not having. */
export const BLIND_SPOTS = [
    'It repairs the request, not the session: the tool history still holds a table in which every active tool arrived as an addition, and the placeholder is what keeps the wire list legal.',
    'The placeholder is a real declaration on the wire; a model that calls it reaches the harness\'s ordinary unknown-tool path, because nothing registers a tool of that name.',
    'The route\'s update mode is resolved per model inside the adapter and is not readable from the waterfall, so the prediction is a set operation over the request, with the provider\'s own refusal as the backstop.',
    'A route that strips `deferLoading` may receive the placeholder without needing it; that costs one unused definition in the tool table.',
];
/**
 * Mount the plugin.
 * @param ctx - the context this plugin is mounted on.
 * @param config - what the operator wrote.
 */
export function apply(ctx, config = {}) {
    const settings = normalizeConfig(config);
    const counters = {
        predicted: 0,
        refusals: 0,
        repairedPredicted: 0,
        repairedRejected: 0,
        errors: 0,
    };
    const say = (level, message) => {
        if (!settings.report)
            return;
        if (level === 'warn')
            ctx.logger.warn(`all-deferred-tools-guard: ${message}`);
        else if (level === 'info')
            ctx.logger.info(`all-deferred-tools-guard: ${message}`);
        else
            ctx.logger.debug(`all-deferred-tools-guard: ${message}`);
    };
    const service = {
        snapshot: () => ({
            mode: settings.mode,
            providers: settings.providers,
            predicted: counters.predicted,
            refusals: counters.refusals,
            repaired: { predicted: counters.repairedPredicted, rejected: counters.repairedRejected },
            errors: counters.errors,
            blindSpots: BLIND_SPOTS,
        }),
    };
    if (settings.mode === 'off') {
        say('info', 'mode is off: no listener is installed');
        ctx.provide(SERVICE, service);
        return;
    }
    installGuard(ctx, {
        observe: settings.mode === 'observe',
        providers: settings.providers,
        onPredict: (verdict, provider) => {
            counters.predicted += 1;
            if (verdict.reason === 'declarations') {
                say('debug', `${provider}: the declaration list itself is all-deferred (${verdict.toolCount} tool(s))`);
            }
            else if (verdict.reason === 'history') {
                say('debug', `${provider}: no usable baseline declaration, so every projection is all-deferred `
                    + `(${verdict.toolCount} active tool(s))`);
            }
            else {
                say('debug', `${provider}: every active tool arrived after the baseline, so addition-only `
                    + `projection is all-deferred (${verdict.toolCount} active tool(s))`);
            }
        },
        onRefuse: (provider) => {
            counters.refusals += 1;
            say('debug', `${provider}: provider refused the request as an all-deferred tool list`);
        },
        onRepair: (source, provider) => {
            if (source === 'predicted')
                counters.repairedPredicted += 1;
            else
                counters.repairedRejected += 1;
            say('debug', `${provider}: ${source === 'predicted' ? 'predicted' : 'provider-refused'} request `
                + 'dispatched with the deferred-tool placeholder');
        },
        onFailure: (error) => {
            counters.errors += 1;
            say('warn', `failed to inspect or repair one request and dispatched it unchanged: ${String(error)}`);
        },
    });
    say('info', `mounted in ${settings.mode} mode `
        + `(${settings.providers.length === 0 ? 'every provider route' : settings.providers.join(', ')}; `
        + 'seam: llm/stream)');
    ctx.provide(SERVICE, service);
}
export { defaultConfig, MODES, normalizeConfig } from "./config.js";
export { installGuard, isAllDeferredRejection } from "./guard.js";
export { PLACEHOLDER_DESCRIPTION, PLACEHOLDER_NAME, PLACEHOLDER_PARAMETERS, placeholder, substitution } from "./substitute.js";
export { hasToolUpdates, inspect } from "./verdict.js";
/**
 * The object a loader entry mounts: the loader normalises a plugin module with
 * `exports.default ?? exports` and hands this to `ctx.plugin`.
 *
 * Deliberately no `Config` key — see the note in `config.ts`.
 */
export default { name, inject, apply };
