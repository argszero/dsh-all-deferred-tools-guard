# Probe lines

`scripts/probe-lines.mjs` calls the **real** `projectToolUpdates` from each
`@deepseek-ai/dsh-llm` release installed under a directory here, so the
prediction in `src/verdict.ts` is checked against the function it predicts
rather than against a transcription of it.

Each `line-*` directory is a throwaway npm project holding one release:

```sh
for v in 0.1.7-rc.2 0.2.0-rc.1 0.2.0-rc.2 0.2.1-alpha.1 0.2.1-alpha.2 \
         0.2.1-alpha.3 0.2.1-alpha.4 0.2.1-alpha.5 0.2.1-rc.1 0.2.1-rc.2; do
  mkdir -p "probe/line-$v" && cd "probe/line-$v"
  npm init -y >/dev/null && npm install --no-audit --no-fund "@deepseek-ai/dsh-llm@$v"
  cd ../..
done
node scripts/probe-lines.mjs
```

The directories themselves are ignored: what is kept is the expectation they
measure, not the megabyte of release tarballs.

Only `line-*` directories are probed — the enumeration skips everything else here,
because a probe set built from `readdirSync` alone fed this file to
`createRequire` and died with `ENOTDIR` before a single line was measured. A
`line-*` directory with no install inside it is named `SKIPPED`, not counted as a
pass either.

Measured on 2026-10-19, on the ten published versions the plugin's declared peer
range admits: every one projects the reported request to 67 tools with every entry
deferred, and the repaired request to 68 with exactly one loadable.

`0.1.7-rc.1` and `0.2.0-rc.1` were measured too, because a range is only honest
when its own boundary has been looked at:

| version | `projectToolUpdates` | reported request projects to |
|---|---|---|
| `0.1.7-rc.1` | absent | — (the predicate reads that function, so the line is refused) |
| `0.2.0-rc.1` | present | 67 tools, all deferred |
| `0.2.0-rc.2` | present | 67 tools, all deferred |

The plugin's `@deepseek-ai/cordis` floor is met on all of them (`4.0.5` shipped on
every line above), so the range is about the projection, not about cordis.
