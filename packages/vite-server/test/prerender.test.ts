import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

import { prerenderRoutes } from '../src/prerender.ts'

const PAGES: Record<string, string> = {
  '/': '<a href="/a">a</a><a href="/b">b</a>',
  '/a': '<a href="/c">c</a>',
  '/b': '',
  '/c': '',
  '/200.html': '',
  '/404.html': '',
}

const HANDLER = `
const pages = ${JSON.stringify(PAGES)}
export function fetch (request) {
  const body = pages[new URL(request.url).pathname]
  return Promise.resolve(body === undefined
    ? new Response('not found', { status: 404 })
    : new Response('<html><body>' + body + '</body></html>', { headers: { 'content-type': 'text/html' } }))
}
`

function createNuxt (): Nuxt {
  return {
    options: {
      dev: false,
      ssr: true,
      app: { baseURL: '/' },
      router: { options: {} },
      routeRules: {},
      experimental: { prerenderErrorPages: false },
      prerender: { routes: ['/'], crawlLinks: true, ignore: [] },
      nitro: { static: true, prerender: { concurrency: 1 } },
    },
    apps: {},
    callHook: () => Promise.resolve(),
  } as unknown as Nuxt
}

describe('prerenderRoutes', () => {
  let dir: string
  let lines: string[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-prerender-'))
    await writeFile(join(dir, 'handler.mjs'), HANDLER)
    lines = []
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'log').mockImplementation((message: unknown) => { lines.push(String(message)) })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('logs how many routes are done out of the routes discovered so far', async () => {
    const routes = await prerenderRoutes(createNuxt(), { publicDir: join(dir, 'public'), handler: join(dir, 'handler.mjs') })

    const counters = lines
      .filter(line => line.startsWith('  ├─ '))
      .map(line => line.match(/\[(\d+)\/(\d+)\]$/)?.slice(1).map(Number))

    expect(counters).toHaveLength(routes.length)
    expect(counters.map(counter => counter?.[0])).toEqual(routes.map((_, index) => index + 1))
    expect(counters.at(-1)).toEqual([routes.length, routes.length])
    // the crawler discovers `/a`, `/b` and `/c` after the first render, so the total grows
    expect(counters[0]![1]).toBeLessThan(routes.length)
  })
})
