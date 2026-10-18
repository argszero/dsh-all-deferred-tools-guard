/**
 * The predicate, read against the shape the report describes.
 *
 * Fixtures are the reported session (discussion #10163): the first request
 * declared `run_code` alone (PTC presentation), a later resume resolved the
 * presentation to native and appended 67 tool additions plus one removal of
 * `run_code`, and `projectToolUpdates` marked every addition deferred.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasToolUpdates, inspect } from '../lib/verdict.js'

const tool = (name, deferred = false) => ({
  name,
  description: `${name} description`,
  parameters: { type: 'object', properties: {} },
  ...(deferred ? { deferLoading: true } : {}),
})

const addition = (toolName) => ({ type: 'tool-addition', toolName })
const removal = (toolName) => ({ type: 'tool-removal', toolName })

const developerMessage = (id, content) => ({ role: 'developer', id, content })

const baseOptions = (overrides = {}) => ({
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  ...overrides,
})

test('a request with no tools is never all-deferred', () => {
  const verdict = inspect(baseOptions())
  assert.deepEqual(verdict, { allDeferred: false, reason: 'none', toolCount: 0 })
})

test('an empty tool list is not treated as all-deferred', () => {
  const verdict = inspect(baseOptions({ tools: [] }))
  assert.equal(verdict.allDeferred, false)
  assert.equal(verdict.reason, 'none')
})

test('a declaration list that is entirely deferred is caught without any history', () => {
  const verdict = inspect(baseOptions({ tools: [tool('a', true), tool('b', true)] }))
  assert.deepEqual(verdict, { allDeferred: true, reason: 'declarations', toolCount: 2 })
})

test('the reported session: 67 additions, the baseline tool removed, every active tool new', () => {
  const additions = Array.from({ length: 67 }, (_, index) => tool(`t${index}`))
  const options = baseOptions({
    tools: additions,
    toolHistory: {
      tools: [tool('run_code')],
      updates: [{ messageId: 'm1', additions }],
    },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      developerMessage('m1', [...additions.map(item => addition(item.name)), removal('run_code')]),
    ],
  })
  const verdict = inspect(options)
  assert.deepEqual(verdict, { allDeferred: true, reason: 'active-new-only', toolCount: 67 })
})

test('one active tool that was declared before the history keeps the list legal', () => {
  const options = baseOptions({
    tools: [tool('run_code'), tool('t0')],
    toolHistory: { tools: [tool('run_code')], updates: [{ messageId: 'm1', additions: [tool('t0')] }] },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      developerMessage('m1', [addition('t0')]),
    ],
  })
  assert.deepEqual(inspect(options), { allDeferred: false, reason: 'none', toolCount: 2 })
})

test('a baseline that is itself entirely deferred leaves both history modes all-deferred', () => {
  const options = baseOptions({
    tools: [tool('run_code', true), tool('t0')],
    toolHistory: { tools: [tool('run_code', true)], updates: [{ messageId: 'm1', additions: [tool('t0')] }] },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      developerMessage('m1', [addition('t0')]),
    ],
  })
  assert.deepEqual(inspect(options), { allDeferred: true, reason: 'history', toolCount: 2 })
})

test('without tool-update messages the history cannot mark anything deferred', () => {
  const options = baseOptions({
    tools: [tool('t0')],
    toolHistory: { tools: [tool('run_code')], updates: [{ messageId: 'm1', additions: [tool('t0')] }] },
  })
  assert.deepEqual(inspect(options), { allDeferred: false, reason: 'none', toolCount: 1 })
})

test('a request without a folded history is read from its declarations alone', () => {
  const options = baseOptions({ tools: [tool('a')] })
  assert.deepEqual(inspect(options), { allDeferred: false, reason: 'none', toolCount: 1 })
})

test('tool updates are recognised in developer messages only', () => {
  assert.equal(hasToolUpdates([{ role: 'user', content: [addition('x')] }]), false)
  assert.equal(hasToolUpdates([developerMessage('m', [removal('x')])]), true)
  assert.equal(hasToolUpdates([developerMessage('m', [{ type: 'text', text: 'plain' }])]), false)
})
