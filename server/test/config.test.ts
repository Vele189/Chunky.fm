import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('refuses to start without an admin password', () => {
    expect(() => loadConfig({})).toThrow(/ADMIN_PASSWORD/)
  })

  it('derives every storage path from AUDIO_STORAGE_DIR', () => {
    const config = loadConfig({ ADMIN_PASSWORD: 'x', AUDIO_STORAGE_DIR: '/srv/media' })

    expect(config.storageDir).toBe('/srv/media')
    expect(config.audioDir).toBe(path.join('/srv/media', 'audio'))
    expect(config.artworkDir).toBe(path.join('/srv/media', 'artwork'))
    expect(config.tmpDir).toBe(path.join('/srv/media', 'tmp'))
    expect(config.dbPath).toBe(path.join('/srv/media', 'chunky.sqlite'))
  })

  it('rejects a nonsense PORT rather than silently defaulting', () => {
    expect(() => loadConfig({ ADMIN_PASSWORD: 'x', PORT: 'eighty' })).toThrow(/PORT/)
  })
})
