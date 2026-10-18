/**
 * Mutation arms: each one breaks the built library in a specific way and asserts
 * the suite notices.
 *
 * A green suite proves the assertions pass on this code; it does not prove they
 * would fail on the wrong code. Each arm below is a claim the suite makes about
 * behaviour, turned into a defect that must turn it red. An arm whose mutation
 * changes nothing observable is marked `equivalent` by name instead of being
 * counted as caught.
 *
 * The mutations are applied to `lib/`, which is what the tests import, and the
 * original file is restored in a `finally` whether the arm caught or not.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const ARMS = [
  {
    name: 'the placeholder reaches the original request instead of the replacement (nothing is inserted)',
    file: 'lib/substitute.js',
    from: '        ...options,\n        tools: [tool, ...tools],',
    to: '        ...options,\n        tools: [...tools],',
  },
  {
    name: 'the placeholder is appended instead of prepended',
    file: 'lib/substitute.js',
    from: '        tools: [tool, ...tools],',
    to: '        tools: [...tools, tool],',
  },
  {
    name: 'the baseline copy in toolHistory is dropped, so addition-only filters the placeholder out again',
    file: 'lib/substitute.js',
    from: '            toolHistory: { tools: [tool, ...history.tools], updates: history.updates },',
    to: '            toolHistory: { tools: [...history.tools], updates: history.updates },',
  },
  {
    name: 'an all-deferred baseline is no longer read as all-deferred',
    file: 'lib/verdict.js',
    from: '    if (baseline.size === 0) {',
    to: '    if (false) {',
  },
  {
    name: 'an active tool that was available from the start is no longer treated as enough',
    file: 'lib/verdict.js',
    from: '        if (active.has(name))\n            return { allDeferred: false, reason: \'none\', toolCount: tools.length };',
    to: '        if (false)\n            return { allDeferred: false, reason: \'none\', toolCount: tools.length };',
  },
  {
    name: 'any provider error is read as the all-deferred refusal',
    file: 'lib/guard.js',
    from: '    return REJECTION.test(reason.failure.message);',
    to: '    return true;',
  },
  {
    name: 'observe mode changes the request after all',
    file: 'lib/guard.js',
    from: '        if (replacement === undefined || policy.observe)\n            return undefined;',
    to: '        if (replacement === undefined)\n            return undefined;',
  },
  {
    name: 'a predicate failure is no longer failed open',
    file: 'lib/guard.js',
    from: '        catch (error) {\n            policy.onFailure(error);\n            return next();\n        }',
    to: '        catch (error) {\n            throw error;\n        }',
  },
]

/** Every arm that must be caught, plus any that are equivalent by name. */
const EQUIVALENT = []

function runSuite() {
  try {
    execFileSync(process.execPath, ['--test', 'test/verdict.spec.mjs', 'test/substitute.spec.mjs', 'test/guard.spec.mjs'], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const baseline = runSuite()
assert.equal(baseline.ok, true, 'the suite must be green before any arm is applied')

const results = []
for (const arm of ARMS) {
  const path = `${root}${arm.file}`
  const original = readFileSync(path, 'utf8')
  assert.ok(original.includes(arm.from), `arm "${arm.name}": the mutation target is not in ${arm.file}`)
  try {
    writeFileSync(path, original.replace(arm.from, arm.to))
    const outcome = runSuite()
    results.push({ name: arm.name, caught: !outcome.ok })
  } finally {
    writeFileSync(path, original)
  }
}

const after = runSuite()
assert.equal(after.ok, true, 'the suite must be green again once every arm is restored')

const missed = results.filter(result => !result.caught)
for (const result of results) {
  console.log(`${result.caught ? 'CAUGHT  ' : 'MISSED  '} ${result.name}`)
}
for (const name of EQUIVALENT) console.log(`EQUIVALENT (named, not run) ${name}`)
console.log(`\n${results.filter(result => result.caught).length}/${results.length} arms caught, `
  + `${EQUIVALENT.length} named equivalent, ${missed.length} missed`)
assert.equal(missed.length, 0, `the suite did not notice: ${missed.map(result => result.name).join('; ')}`)
