import { describe, expect, it } from 'vitest'
import type { CanopiFile } from '../types/design'
import {
  createDesignWriteAdmission,
  prepareDesignWriteDestination,
  prepareSynchronousDesignWriteDestination,
} from '../app/document-session/write-admission'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('Design write admission', () => {
  it('holds replacement admission through exact write settlement', async () => {
    const admission = createDesignWriteAdmission()
    const settlement = deferred<void>()
    const events: string[] = []
    const destination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('write')
      },
    })

    const writing = admission.execute(
      destination,
      {} as CanopiFile,
      () => true,
      async () => {
        events.push('settling')
        await settlement.promise
        events.push('settled')
        return 'published'
      },
    )
    const replacing = admission.withReplacementFence(async () => {
      events.push('replace')
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual(['write', 'settling'])

    settlement.resolve()
    await expect(writing).resolves.toEqual({
      status: 'written',
      value: 'published',
    })
    await replacing
    expect(events).toEqual(['write', 'settling', 'settled', 'replace'])
  })

  it('defers a reentrant replacement until synchronous storage settles', async () => {
    const admission = createDesignWriteAdmission()
    const events: string[] = []
    let replacing!: Promise<void>
    const destination = prepareSynchronousDesignWriteDestination({
      resource: 'browser-app-data:canopi:web-app-data:v1',
      write() {
        events.push('write')
        replacing = admission.withReplacementFence(async () => {
          events.push('replace')
        })
        return undefined
      },
    })

    const result = admission.executeImmediately(
      destination,
      {} as CanopiFile,
      () => true,
      () => {
        events.push('settle')
        return 'published'
      },
    )

    expect(result).toEqual({ status: 'written', value: 'published' })
    expect(events).toEqual(['write', 'settle'])
    await replacing
    expect(events).toEqual(['write', 'settle', 'replace'])
  })

  it('releases a replacement drain after an admitted writer rejects', async () => {
    const admission = createDesignWriteAdmission()
    const write = deferred<void>()
    const events: string[] = []
    const destination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      async write() {
        events.push('write')
        await write.promise
      },
    })

    const writing = admission.execute(
      destination,
      {} as CanopiFile,
      () => true,
      () => events.push('settle'),
    )
    const replacing = admission.withReplacementFence(async () => {
      events.push('replace')
    })

    write.reject(new Error('disk full'))
    await expect(writing).rejects.toThrow('disk full')
    await replacing
    expect(events).toEqual(['write', 'replace'])
  })

  it('does not make an admitted browser download block replacement', async () => {
    const admission = createDesignWriteAdmission()
    const write = deferred<void>()
    const events: string[] = []
    const destination = prepareDesignWriteDestination({
      resource: 'browser-download:opaque-test-destination',
      blocksReplacement: false,
      async write() {
        events.push('write')
        await write.promise
        events.push('written')
      },
    })

    const writing = admission.execute(
      destination,
      {} as CanopiFile,
      () => true,
      () => events.push('settled'),
    )
    await Promise.resolve()
    const replacing = admission.withReplacementFence(async () => {
      events.push('replace')
    })

    await replacing
    expect(events).toEqual(['write', 'replace'])

    write.resolve()
    await writing
    expect(events).toEqual(['write', 'replace', 'written', 'settled'])
  })

  it('releases gated writes when admission is disposed', async () => {
    const admission = createDesignWriteAdmission()
    const replacement = deferred<void>()
    const events: string[] = []
    let current = true
    const destination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('write')
      },
    })
    const replacing = admission.withReplacementFence(() => replacement.promise)
    const writing = admission.execute(
      destination,
      {} as CanopiFile,
      () => current,
      () => events.push('settled'),
    )
    await Promise.resolve()

    expect(events).toEqual([])
    current = false
    admission.dispose()

    await expect(writing).resolves.toEqual({ status: 'stale' })
    expect(events).toEqual([])

    replacement.resolve()
    await replacing
  })

  it('reserves gated same-resource writes in issue order before reentry', async () => {
    const admission = createDesignWriteAdmission()
    const replacement = deferred<void>()
    const events: string[] = []
    let thirdWrite!: Promise<unknown>
    const thirdDestination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('third')
      },
    })
    const firstDestination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('first')
        thirdWrite = admission.execute(
          thirdDestination,
          {} as CanopiFile,
          () => true,
          () => undefined,
        )
      },
    })
    const secondDestination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('second')
      },
    })
    const replacing = admission.withReplacementFence(() => replacement.promise)

    const firstWrite = admission.execute(
      firstDestination,
      {} as CanopiFile,
      () => true,
      () => undefined,
    )
    const secondWrite = admission.execute(
      secondDestination,
      {} as CanopiFile,
      () => true,
      () => undefined,
    )
    replacement.resolve()

    await replacing
    await firstWrite
    await secondWrite
    await thirdWrite
    expect(events).toEqual(['first', 'second', 'third'])
  })

  it('does not let a nonblocking write leapfrog a gated same-resource write', async () => {
    const admission = createDesignWriteAdmission()
    const replacement = deferred<void>()
    const events: string[] = []
    const blockingDestination = prepareDesignWriteDestination({
      resource: 'browser-shared:test-resource',
      write() {
        events.push('blocking')
      },
    })
    const nonblockingDestination = prepareDesignWriteDestination({
      resource: 'browser-shared:test-resource',
      blocksReplacement: false,
      write() {
        events.push('nonblocking')
      },
    })
    const replacing = admission.withReplacementFence(() => replacement.promise)
    const blockingWrite = admission.execute(
      blockingDestination,
      {} as CanopiFile,
      () => true,
      () => undefined,
    )
    const nonblockingWrite = admission.execute(
      nonblockingDestination,
      {} as CanopiFile,
      () => true,
      () => undefined,
    )
    await Promise.resolve()

    expect(events).toEqual([])

    replacement.resolve()
    await replacing
    await blockingWrite
    await nonblockingWrite
    expect(events).toEqual(['blocking', 'nonblocking'])
  })

  it('reserves a resource lane before an async writer reenters admission', async () => {
    const admission = createDesignWriteAdmission()
    const firstSettlement = deferred<void>()
    const events: string[] = []
    let reentrantWrite!: Promise<unknown>
    const destination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('write')
        if (events.length === 1) {
          reentrantWrite = admission.execute(
            destination,
            {} as CanopiFile,
            () => true,
            () => 'second-settled',
          )
        }
      },
    })

    const firstWrite = admission.execute(
      destination,
      {} as CanopiFile,
      () => true,
      async () => {
        await firstSettlement.promise
        return 'first-settled'
      },
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual(['write'])

    firstSettlement.resolve()
    await firstWrite
    await reentrantWrite
    expect(events).toEqual(['write', 'write'])
  })

  it('blocks a replacement that an async writer starts reentrantly', async () => {
    const admission = createDesignWriteAdmission()
    const settlement = deferred<void>()
    const events: string[] = []
    let replacing!: Promise<void>
    const destination = prepareDesignWriteDestination({
      resource: 'native-design:/designs/garden.canopi',
      write() {
        events.push('write')
        replacing = admission.withReplacementFence(async () => {
          events.push('replace')
        })
      },
    })

    const writing = admission.execute(
      destination,
      {} as CanopiFile,
      () => true,
      async () => {
        events.push('settling')
        await settlement.promise
      },
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual(['write', 'settling'])

    settlement.resolve()
    await writing
    await replacing
    expect(events).toEqual(['write', 'settling', 'replace'])
  })
})
