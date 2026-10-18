/**
 * The replacement request: what it contains, what it leaves alone, and that it
 * is built once per request.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PLACEHOLDER_DESCRIPTION,
  PLACEHOLDER_NAME,
  placeholder,
  substitution,
} from '../lib/substitute.js'

const tool = (name, deferred = false) => ({
  name,
  description: `${name} description`,
  parameters: { type: 'object', properties: {} },
  ...(deferred ? { deferLoading: true } : {}),
})

const baseOptions = (overrides = {}) => ({
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  ...overrides,
})

test('the placeholder is the pi-ai adapter\'s own declaration, name and description included', () => {
  const tool = placeholder()
  assert.equal(tool.name, 'DeferredToolPlaceholder')
  assert.equal(tool.description, 'Reserved placeholder that keeps deferred tool loading active; never call this tool.')
  assert.deepEqual(tool.parameters, { type: 'object', properties: {} })
  assert.equal(tool.deferLoading, undefined)
  assert.equal(PLACEHOLDER_NAME, 'DeferredToolPlaceholder')
  assert.equal(PLACEHOLDER_DESCRIPTION, tool.description)
})

test('every call builds a fresh placeholder, so a frozen first request cannot freeze the second', () => {
  const first = placeholder()
  const second = placeholder()
  assert.notEqual(first, second)
  assert.notEqual(first.parameters, second.parameters)
})

test('the replacement puts the placeholder first in both the active list and the baseline', () => {
  const tools = [tool('a'), tool('b')]
  const updates = [{ messageId: 'm1', additions: [tool('a'), tool('b')] }]
  const options = baseOptions({ tools, toolHistory: { tools: [tool('run_code')], updates } })
  const replacement = substitution(options)
  assert.deepEqual(replacement.tools.map(item => item.name), ['DeferredToolPlaceholder', 'a', 'b'])
  assert.deepEqual(replacement.toolHistory.tools.map(item => item.name), ['DeferredToolPlaceholder', 'run_code'])
  assert.equal(replacement.toolHistory.updates, updates, 'the update list is shared, not copied')
})

test('a request without a folded history only needs the placeholder in the active list', () => {
  const replacement = substitution(baseOptions({ tools: [tool('a')] }))
  assert.deepEqual(replacement.tools.map(item => item.name), ['DeferredToolPlaceholder', 'a'])
  assert.equal('toolHistory' in replacement, false)
})

test('the original request is never mutated', () => {
  const tools = [tool('a')]
  const options = Object.freeze({ ...baseOptions({ tools: Object.freeze([...tools]) }) })
  const before = JSON.stringify(options)
  const replacement = substitution(options)
  assert.notEqual(replacement, options)
  assert.equal(JSON.stringify(options), before)
  assert.equal(options.tools.length, 1)
})

test('a request with no tools is not repaired', () => {
  assert.equal(substitution(baseOptions()), undefined)
  assert.equal(substitution(baseOptions({ tools: [] })), undefined)
})

test('a request that already carries the placeholder is not repaired twice', () => {
  const once = substitution(baseOptions({ tools: [tool('a')] }))
  assert.equal(substitution(once), undefined)
  const withHistory = substitution(baseOptions({
    tools: [tool('a')],
    toolHistory: { tools: [tool('run_code')], updates: [] },
  }))
  assert.equal(substitution(withHistory), undefined)
})

test('a session that legitimately declares a tool by that name is left alone', () => {
  const options = baseOptions({
    tools: [tool('a')],
    toolHistory: { tools: [tool(PLACEHOLDER_NAME)], updates: [] },
  })
  assert.equal(substitution(options), undefined)
})
