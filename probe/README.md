# Probe lines

`scripts/probe-lines.mjs` calls the **real** `projectToolUpdates` from each
`@deepseek-ai/dsh-llm` release installed under a directory here, so the
prediction in `src/verdict.ts` is checked against the function it predicts
rather than against a transcription of it.

Each `line-*` directory is a throwaway npm project holding one release:

```sh
for v in 0.2.0-rc.2 0.2.1-rc.2; do
  mkdir -p "probe/line-$v" && cd "probe/line-$v"
  npm init -y >/dev/null && npm install --no-audit --no-fund "@deepseek-ai/dsh-llm@$v"
  cd ../..
done
node scripts/probe-lines.mjs
```

The directories themselves are ignored: what is kept is the expectation they
measure, not the megabyte of release tarballs.

Measured on 2026-10-19, on `0.2.0-rc.2` and `0.2.1-rc.2`: the reported request
projects to 67 tools with every entry deferred, and the repaired request projects
to 68 with exactly one loadable.
