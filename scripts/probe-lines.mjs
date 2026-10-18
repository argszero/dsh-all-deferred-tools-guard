/**
 * Cross-line probe: the diagnosis and the repair, checked against the harness's
 * own shipped projection on more than one released line.
 *
 * The predicate in `src/verdict.ts` predicts what `projectToolUpdates` will
 * produce. A prediction about someone else's function is only worth what the
 * function does, so this script calls the real one — from the version of
 * `@deepseek-ai/dsh-llm` installed under each `probe/line-*` directory — and
 * asserts two things per line:
 *
 * 1. the reported request really does project to a tool list in which every
 *    entry is deferred, which is the shape the provider refuses;
 * 2. the request this plugin builds from it projects to a list whose first entry
 *    is the placeholder, with no `deferLoading` flag at all.
 *
 * A line whose package does not export `projectToolUpdates` is named as skipped
 * rather than counted as passing.
 *
 * Usage: `node scripts/probe-lines.mjs`
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { substitution } from '../lib/substitute.js'
import { inspect } from '../lib/verdict.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const probeRoot = join(root, 'probe')

const tool = (name, deferred = false) => ({
  name,
  description: `${name} description`,
  parameters: { type: 'object', properties: {} },
  ...(deferred ? { deferLoading: true } : {}),
})

const addition = (toolName) => ({ type: 'tool-addition', toolName })
const removal = (toolName) => ({ type: 'tool-removal', toolName })

/** The reported session: 67 additions, the one baseline tool removed, PTC → native. */
function reported() {
  const additions = Array.from({ length: 67 }, (_, index) => tool(`t${index}`))
  return {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'developer', id: 'm1', content: [...additions.map(item => addition(item.name)), removal('run_code')] },
    ],
    tools: additions,
    toolHistory: { tools: [tool('run_code')], updates: [{ messageId: 'm1', additions }] },
  }
}

/** Import one installed line's own projection. */
async function projectionOf(directory) {
  const require = createRequire(join(directory, 'package.json'))
  const manifest = JSON.parse(readFileSync(join(directory, 'node_modules/@deepseek-ai/dsh-llm/package.json'), 'utf8'))
  const entry = require.resolve('@deepseek-ai/dsh-llm')
  const module = await import(pathToFileURL(entry).href)
  return { version: manifest.version, projectToolUpdates: module.projectToolUpdates }
}

const report = []
for (const name of readdirSync(probeRoot).sort()) {
  const directory = join(probeRoot, name)
  const { version, projectToolUpdates } = await projectionOf(directory)
  if (typeof projectToolUpdates !== 'function') {
    report.push({ name, version, outcome: 'SKIPPED (no projectToolUpdates export)' })
    continue
  }
  const before = reported()
  const verdict = inspect(before)
  assert.deepEqual(verdict, { allDeferred: true, reason: 'active-new-only', toolCount: 67 },
    `${version}: the predicate must read the reported request as all-deferred`)

  const broken = projectToolUpdates(before.messages, before.tools, 'addition-only', before.toolHistory)
  assert.equal(broken.tools.length, 67, `${version}: every active tool survives the active-name filter`)
  assert.equal(broken.tools.every(item => item.deferLoading === true), true,
    `${version}: the shipped projection really does produce an all-deferred list`)

  const after = substitution(before)
  const fixed = projectToolUpdates(after.messages, after.tools, 'addition-only', after.toolHistory)
  assert.equal(fixed.tools.length, 68, `${version}: the repaired request carries one more definition`)
  const [head] = fixed.tools
  assert.equal(head.name, 'DeferredToolPlaceholder', `${version}: the placeholder is first`)
  assert.equal(head.deferLoading, undefined, `${version}: and it is not deferred`)

  // The same repair under the other reading of the projection.
  const unfiltered = projectToolUpdates(after.messages, after.tools, 'in-history', after.toolHistory)
  assert.equal(unfiltered.tools[0].name, 'DeferredToolPlaceholder', `${version}: in-history seeds it too`)
  assert.equal(unfiltered.tools[0].deferLoading, undefined, `${version}: in-history keeps it loadable`)

  const loads = fixed.tools.filter(item => item.deferLoading !== true).length
  report.push({ name, version, outcome: `PASS (${fixed.tools.length} tools, ${loads} loadable)` })
}

for (const line of report) console.log(`${line.outcome.padEnd(34)} ${line.name} = ${line.version}`)
const passed = report.filter(line => line.outcome.startsWith('PASS')).length
console.log(`\n${passed}/${report.length} probed lines reproduce the failure and accept the repair`)
assert.ok(passed > 0, 'no line could be probed')
