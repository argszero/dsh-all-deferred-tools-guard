/**
 * Configuration, normalized once at mount.
 *
 * Three questions, and no more: *how much should it do* (`mode`), *which routes
 * does it cover* (`providers`), and *how loudly* (`report`).
 *
 * Deliberately **not** exported as the plugin's `Config`: cordis validates a
 * mounted plugin's `Config` through `Config['~standard'].validate`, and a plain
 * defaults object has no `~standard`. Exporting one is how this task's earlier
 * plugins died at mount with `Cannot read properties of undefined (reading
 * 'validate')`; the entry point exports `{ name, inject, apply }` with no
 * `Config` at all, and these defaults arrive through `apply(ctx, config = {})`.
 *
 * @module @argszero/dsh-all-deferred-tools-guard/config
 */
/**
 * What the plugin does.
 *
 * - `guard` (the default) repairs the request.
 * - `observe` decides exactly as `guard` would and changes nothing — the way to
 *   find out whether a route actually produces the shape before trusting a
 *   rewrite with it.
 * - `off` installs no listener at all.
 */
export type GuardMode = 'guard' | 'observe' | 'off';
/** The plugin configuration as a user writes it. */
export interface Config {
    /** Whether the plugin guards, only observes, or is off. */
    readonly mode?: GuardMode;
    /**
     * Provider routes to cover, matched exactly (`deepseek-account`,
     * `deepseek-v4-pro`, …). Empty — the default — means every route, which is
     * the point: the guard is cheap, and a route this plugin has never seen can
     * still receive the shape from an adapter that marks deferral its own way.
     */
    readonly providers?: readonly string[];
    /** Log one line per decision at `debug`, failures and the mount summary at `info`. */
    readonly report?: boolean;
}
/** The configuration with every default resolved. */
export interface Settings {
    readonly mode: GuardMode;
    readonly providers: readonly string[];
    readonly report: boolean;
}
/** The defaults, also the fallbacks used per field. */
export declare const defaultConfig: Required<Config>;
/** Every mode, in the order documentation lists them. */
export declare const MODES: readonly GuardMode[];
/**
 * Resolve every field of a written configuration.
 *
 * An unknown mode is refused by name rather than silently treated as `guard`:
 * an operator who wrote `observation` has to learn that nothing is watching,
 * whereas silently guarding would be a plugin doing more than it was told.
 * @param config - what the operator wrote.
 * @returns the resolved settings.
 * @throws RangeError when `mode` is not one of {@link MODES}.
 */
export declare function normalizeConfig(config?: Config): Settings;
//# sourceMappingURL=config.d.ts.map