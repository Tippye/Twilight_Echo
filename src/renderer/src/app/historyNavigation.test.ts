import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createHistoryCommandRouter } from './historyNavigation.ts'

function mouseUpEvent(button: number) {
  let prevented = 0
  const event = {
    button,
    preventDefault: () => prevented++
  } as unknown as MouseEvent
  return { event, prevented: () => prevented }
}

function recordingRouter(now: () => number = () => 0) {
  const steps: string[] = []
  const router = createHistoryCommandRouter(
    {
      back: () => {
        steps.push('back')
        return true
      },
      forward: () => {
        steps.push('forward')
        return true
      }
    },
    now
  )
  return { router, steps }
}

test('back and forward commands resolve their own history stack', () => {
  let time = 0
  const { router, steps } = recordingRouter(() => time)

  assert.equal(router.run('back'), true)
  assert.deepEqual(steps, ['back'])

  time += 5
  assert.equal(router.run('back'), false, 'the same press delivered twice moves one step')

  time += 5
  assert.equal(router.run('forward'), true, 'the opposite direction is an independent press')
  assert.deepEqual(steps, ['back', 'forward'])

  time += 200
  assert.equal(router.run('back'), true, 'a deliberate second press still goes back')
  assert.deepEqual(steps, ['back', 'forward', 'back'])
})

test('a step that found nowhere to go does not swallow the next press', () => {
  let canGoBack = false
  const router = createHistoryCommandRouter(
    { back: () => canGoBack, forward: () => false },
    () => 0
  )

  assert.equal(router.run('back'), false)
  canGoBack = true
  assert.equal(router.run('back'), true)
})

test('mouse side buttons map to back and forward while other buttons stay untouched', () => {
  const { router, steps } = recordingRouter()
  for (const button of [0, 1, 2]) {
    const primary = mouseUpEvent(button)
    assert.equal(router.handleMouseUp(primary.event), false)
    assert.equal(primary.prevented(), 0)
  }

  const back = mouseUpEvent(3)
  assert.equal(router.handleMouseUp(back.event), true)
  assert.equal(back.prevented(), 1)

  const forward = mouseUpEvent(4)
  assert.equal(router.handleMouseUp(forward.event), true)
  assert.equal(forward.prevented(), 1)

  assert.deepEqual(steps, ['back', 'forward'])
})

test('the IPC delivery and the DOM delivery of one press only move one step', () => {
  const steps: string[] = []
  const router = createHistoryCommandRouter(
    {
      back: () => {
        steps.push('back')
        return true
      },
      forward: () => {
        steps.push('forward')
        return true
      }
    },
    () => 1234
  )

  // Windows/Linux app-command path first, then the XBUTTON mouseup fallback.
  assert.equal(router.run('back'), true)
  assert.equal(router.handleMouseUp(mouseUpEvent(3).event), true)
  assert.deepEqual(steps, ['back'])
})

test('the shell wires both mouse history paths onto the shared navigation stacks', () => {
  const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

  assert.match(app, /back: \(\) => backStack\.goBack\(\)/)
  assert.match(app, /forward: \(\) => navigation\.goForwardPage\(\)/)
  assert.match(app, /window\.api\.app\.onHistoryCommand\(routeHistoryCommand\.run\)/)
  assert.match(
    app,
    /window\.addEventListener\('mouseup', routeHistoryCommand\.handleMouseUp, true\)/
  )
  assert.match(app, /removeHistoryCommandListener\?\.\(\)/)
  assert.match(
    app,
    /window\.removeEventListener\('mouseup', routeHistoryCommand\.handleMouseUp, true\)/
  )
})
