/**
 * The peer range, under both semver readings.
 *
 * This task has already shipped a plugin whose range was correct for the
 * harness's own compatibility gate (`includePrerelease: true`) and wrong for
 * npm, which reads the range with the default options and answers `ERESOLVE`.
 * One range, two consumers, two readings — so the assertion here is not "the
 * newest line matches", it is "both readings admit exactly the same set".
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import semver from 'semver'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const range = pkg.peerDependencies['@deepseek-ai/dsh-llm']

/**
 * The dsh lines published as of 2026-10-19, plus the versions that make the two
 * readings disagree when a segment's upper bound is written without its `-0`.
 */
const ADMITTED = [
  '0.1.7-rc.2',
  '0.2.0-rc.2',
  '0.2.1-alpha.1',
  '0.2.1-alpha.5',
  '0.2.1-rc.1',
  '0.2.1-rc.2',
]
const REFUSED = [
  '0.1.7-rc.1',
  '0.2.0-rc.1',
  '0.2.1-alpha.0',
  '0.2.1-alpha.0.1',
  '0.2.2-alpha.1',
  '0.2.2',
  '0.3.0-rc.1',
]

test('the peer range is a segment per line, so a prerelease is admitted under both readings', () => {
  for (const version of ADMITTED) {
    assert.equal(semver.satisfies(version, range), true, `${version} must be admitted with default options`)
    assert.equal(semver.satisfies(version, range, { includePrerelease: true }), true,
      `${version} must be admitted by the harness gate`)
  }
  for (const version of REFUSED) {
    assert.equal(semver.satisfies(version, range), false, `${version} must be refused with default options`)
    assert.equal(semver.satisfies(version, range, { includePrerelease: true }), false,
      `${version} must be refused by the harness gate`)
  }
})

test('both readings agree over every line this plugin knows about', () => {
  const lines = [...ADMITTED, ...REFUSED]
  const strict = lines.filter(version => semver.satisfies(version, range))
  const prerelease = lines.filter(version => semver.satisfies(version, range, { includePrerelease: true }))
  assert.deepEqual(strict, prerelease)
})

test('the bundle declaration is what the loader looks for', () => {
  assert.deepEqual(pkg.dsh.bundle, { patch: './cordis.patch.yml' })
  assert.equal(pkg.type, 'module')
  assert.deepEqual(pkg.exports['.'], { types: './lib/types/index.d.ts', default: './lib/index.js' })
  assert.equal(pkg.dependencies, undefined, 'a runtime dependency can materialize a second harness copy')
})
