/**
 * The listener, driven through the real `apply` entry point with a stand-in
 * context: what it dispatches, what it leaves to `next()`, and that a failure
 * never costs a model call.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin, { apply, isAllDeferredRejection } from '../lib/index.js'

const tool = (name, deferred = false) => ({
  name,
  description: `${name} description`,
  parameters: { type: 'object', properties: {} },
  ...(deferred ? { deferLoading: true } : {}),
})

const addition = (toolName) => ({ type: 'tool-addition', toolName })

const text = (value) => ({ type: 'text-delta', index: 0, text: value })

const finish = (reason) => ({ type: 'finish', reason })

const refusalChunk = (message = 'tools: at least one tool must have defer_loading=false. All tools cannot be deferred.') =>
  finish({ kind: 'error', failure: { code: 'INVALID_REQUEST', status: 400, message } })

/** A context that records what the plugin asks of it. */
function harness() {
  const listeners = []
  const streams = []
  const services = {}
  const logs = []
  const ctx = {
    on(event, listener, options) {
      listeners.push({ event, listener, options })
      return () => {}
    },
    provide(name, service) {
      services[name] = service
    },
    logger: {
      info: (message) => logs.push(['info', message]),
      debug: (message) => logs.push(['debug', message]),
      warn: (message) => logs.push(['warn', message]),
    },
    llm: {
      stream(request) {
        streams.push(request)
        return (async function* repaired() {
          yield text('repaired')
          yield finish({ kind: 'stop' })
        })()
      },
    },
  }
  return { ctx, listeners, streams, services, logs }
}

/** The request from the report: 67 additions, the one baseline tool removed. */
function poisoned(overrides = {}) {
  const additions = Array.from({ length: 67 }, (_, index) => tool(`t${index}`))
  return {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'developer', id: 'm1', content: additions.map(item => addition(item.name)) },
    ],
    tools: additions,
    toolHistory: { tools: [tool('run_code')], updates: [{ messageId: 'm1', additions }] },
    ...overrides,
  }
}

/** A request in the tool-update regime that the prediction cannot fault. */
function ambiguous() {
  return {
    provider: 'some-route',
    model: 'm',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'developer', id: 'm1', content: [addition('b')] },
    ],
    tools: [tool('a'), tool('b')],
    toolHistory: { tools: [tool('a')], updates: [{ messageId: 'm1', additions: [tool('b')] }] },
  }
}

/** A request with no tool updates at all. */
function plain() {
  return {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [tool('a')],
  }
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function mount(config) {
  const world = harness()
  apply(world.ctx, config)
  assert.equal(world.listeners.length, 1)
  return { ...world, listen: world.listeners[0] }
}

test('the entry point is the loader shape and takes the llm service', () => {
  assert.equal(plugin.name, 'all-deferred-tools-guard')
  assert.deepEqual(plugin.inject, ['llm'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal('Config' in plugin, false, 'a Config export would break the mount')
})

test('the listener is global and prepended, so no other listener forwards the request first', () => {
  const world = mount({})
  assert.equal(world.listen.event, 'llm/stream')
  assert.deepEqual(world.listen.options, { global: true, prepend: true })
})

test('a poisoned request is replaced before dispatch, and the replacement carries the placeholder', async () => {
  const world = mount({})
  const next = () => (async function* untouched() { yield text('unrepaired') })()
  const chunks = await collect(world.listen.listener(poisoned(), next))
  assert.deepEqual(chunks.map(chunk => chunk.type), ['text-delta', 'finish'])
  assert.equal(chunks[0].text, 'repaired', 'the provider never sees the original request')
  assert.equal(world.streams.length, 1)
  assert.equal(world.streams[0].tools[0].name, 'DeferredToolPlaceholder')
  assert.equal(world.streams[0].toolHistory.tools[0].name, 'DeferredToolPlaceholder')
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.mode, 'guard')
  assert.equal(snapshot.predicted, 1)
  assert.equal(snapshot.repaired.predicted, 1)
  assert.equal(snapshot.errors, 0)
})

test('the replacement is not repaired again when the waterfall calls this listener back', async () => {
  const world = mount({})
  const next = () => (async function* untouched() { yield text('unrepaired') })()
  await collect(world.listen.listener(poisoned(), next))
  const replacement = world.streams[0]
  const chunks = await collect(world.listen.listener(replacement, next))
  assert.equal(chunks[0].text, 'unrepaired', 'a recorded replacement goes to next()')
  assert.equal(world.streams.length, 1, 'and is not dispatched a second time')
})

test('a legal request is handed to next() untouched', async () => {
  const world = mount({})
  const next = () => (async function* untouched() { yield text('unrepaired') })()
  const chunks = await collect(world.listen.listener(plain(), next))
  assert.equal(chunks[0].text, 'unrepaired')
  assert.equal(world.streams.length, 0)
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.predicted, 0)
  assert.equal(snapshot.repaired.predicted, 0)
})

test('observe mode decides and counts, and dispatches the original request', async () => {
  const world = mount({ mode: 'observe' })
  let reached = 0
  const next = () => {
    reached += 1
    return (async function* untouched() { yield text('unrepaired') })()
  }
  const chunks = await collect(world.listen.listener(poisoned(), next))
  assert.equal(chunks[0].text, 'unrepaired')
  assert.equal(reached, 1)
  assert.equal(world.streams.length, 0, 'observe never re-dispatches')
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.mode, 'observe')
  assert.equal(snapshot.predicted, 1)
  assert.equal(snapshot.repaired.predicted, 0)
})

test('off installs no listener and still answers the snapshot', () => {
  const world = harness()
  apply(world.ctx, { mode: 'off' })
  assert.equal(world.listeners.length, 0)
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.mode, 'off')
  assert.equal(snapshot.predicted, 0)
})

test('the provider\'s own refusal is the second trigger, and it replaces the attempt', async () => {
  const world = mount({})
  const next = () => (async function* refused() { yield refusalChunk() })()
  const chunks = await collect(world.listen.listener(ambiguous(), next))
  assert.equal(chunks[0].text, 'repaired')
  assert.equal(world.streams.length, 1)
  assert.equal(world.streams[0].tools[0].name, 'DeferredToolPlaceholder')
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.refusals, 1)
  assert.equal(snapshot.repaired.rejected, 1)
  assert.equal(snapshot.predicted, 0)
})

test('the refusal is recognised in both spellings and nowhere else', () => {
  assert.equal(isAllDeferredRejection(refusalChunk()), true)
  assert.equal(isAllDeferredRejection(refusalChunk('All tools cannot be deferred.')), true)
  assert.equal(isAllDeferredRejection(refusalChunk('tools.5.name: string too long')), false)
  assert.equal(isAllDeferredRejection(text('All tools cannot be deferred.')), false)
  assert.equal(isAllDeferredRejection(finish({ kind: 'stop' })), false)
  assert.equal(isAllDeferredRejection(finish({
    kind: 'aborted',
    failure: { code: 'ABORTED', message: 'All tools cannot be deferred.' },
  })), false)
})

test('a stream that opens with content is forwarded whole and never re-dispatched', async () => {
  const world = mount({})
  const next = () => (async function* normal() {
    yield text('one')
    yield text('two')
    yield finish({ kind: 'stop' })
  })()
  const chunks = await collect(world.listen.listener(ambiguous(), next))
  assert.deepEqual(chunks.map(chunk => chunk.type), ['text-delta', 'text-delta', 'finish'])
  assert.equal(world.streams.length, 0)
  assert.equal(world.services.allDeferredToolsGuard.snapshot().refusals, 0)
})

test('a refusal that cannot be repaired is forwarded unchanged', async () => {
  const world = mount({})
  // A request the prediction passes (one active tool was available from the
  // start) that already carries the placeholder: the reactive arm sees the
  // refusal and has nothing left to insert.
  const options = ambiguous()
  options.tools = [tool('DeferredToolPlaceholder'), tool('a'), tool('b')]
  const refusal = refusalChunk()
  const next = () => (async function* refused() { yield refusal })()
  const chunks = await collect(world.listen.listener(options, next))
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], refusal)
  assert.equal(world.streams.length, 0)
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.refusals, 1)
  assert.equal(snapshot.repaired.rejected, 0)
})

test('a predicted request that already carries the placeholder is handed on, not watched', async () => {
  const world = mount({})
  const options = poisoned()
  options.tools = [tool('DeferredToolPlaceholder'), ...options.tools]
  let reached = 0
  const next = () => {
    reached += 1
    return (async function* untouched() { yield text('unrepaired') })()
  }
  const chunks = await collect(world.listen.listener(options, next))
  assert.equal(chunks[0].text, 'unrepaired')
  assert.equal(reached, 1)
  assert.equal(world.streams.length, 0)
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.predicted, 1, 'the prediction still runs and is visible')
  assert.equal(snapshot.repaired.predicted, 0, 'and nothing is claimed as repaired')
})

test('an early consumer stop closes the upstream stream', async () => {
  const world = mount({})
  let closed = false
  const next = () => (async function* slow() {
    try {
      yield text('one')
      yield text('two')
    } finally {
      closed = true
    }
  })()
  for await (const chunk of world.listen.listener(ambiguous(), next)) {
    assert.equal(chunk.text, 'one')
    break
  }
  assert.equal(closed, true)
})

test('a provider this plugin does not cover is passed straight through', async () => {
  const world = mount({ providers: ['deepseek-account'] })
  const next = () => (async function* untouched() { yield text('unrepaired') })()
  const chunks = await collect(world.listen.listener(poisoned({ provider: 'other-route' }), next))
  assert.equal(chunks[0].text, 'unrepaired')
  assert.equal(world.streams.length, 0)
})

test('a covered provider is still guarded when a list names it', async () => {
  const world = mount({ providers: ['deepseek-account'] })
  const next = () => (async function* untouched() { yield text('unrepaired') })()
  await collect(world.listen.listener(poisoned(), next))
  assert.equal(world.streams.length, 1)
})

test('a predicate failure fails open, counts, and warns', async () => {
  const world = mount({})
  const next = () => (async function* untouched() { yield text('unrepaired') })()
  const malformed = poisoned({ tools: { length: 3 } })
  const chunks = await collect(world.listen.listener(malformed, next))
  assert.equal(chunks[0].text, 'unrepaired')
  assert.equal(world.streams.length, 0)
  const snapshot = world.services.allDeferredToolsGuard.snapshot()
  assert.equal(snapshot.errors, 1)
  assert.ok(world.logs.some(([level, message]) => level === 'warn' && message.includes('dispatched it unchanged')))
})

test('an unknown mode is refused by name at mount', () => {
  const world = harness()
  assert.throws(() => apply(world.ctx, { mode: 'observation' }), /unknown mode observation/)
  assert.equal(world.listeners.length, 0)
})

test('nothing is reported when report is false', () => {
  const world = mount({ report: false })
  assert.equal(world.logs.length, 0)
})
