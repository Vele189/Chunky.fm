import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('comes up with an admin password of its own when none is set', () => {
    // This used to throw. It now falls back to the house key, so an
    // unconfigured station has one code that opens both doors.
    expect(loadConfig({}).adminPassword).toBeTruthy()
  })

  it('takes the admin password it is given', () => {
    expect(loadConfig({ ADMIN_PASSWORD: 'chosen' }).adminPassword).toBe('chosen')
  })

  it('ignores an admin password that is only whitespace', () => {
    expect(loadConfig({ ADMIN_PASSWORD: '  ' }).adminPassword).toBe(loadConfig({}).adminPassword)
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

/**
 * The door.
 *
 * Deliberately no literal in here. The house key is written backwards and in
 * base64 in `config.ts` precisely so it is not sitting in plain text anywhere,
 * and a test that spelled it out would put it back — in a file that gets read
 * far more often than the one it was hidden in. So these pin the *behaviour*:
 * that there is a door, that you can change its lock, and that you have to say
 * so out loud to take the door off.
 */
describe('the station door', () => {
  it('comes with a lock on it', () => {
    // The default changed direction: this used to be null.
    const config = loadConfig({})
    expect(config.stationKey).not.toBeNull()
    expect(config.stationKey).not.toBe('')
  })

  it('is the same lock every time, so a restart does not lock everyone out', () => {
    // The signing key for a listener cookie is derived from this, so a value
    // that moved between boots would end every invite on every deploy.
    expect(loadConfig({ ADMIN_PASSWORD: 'x' }).stationKey).toBe(
      loadConfig({ ADMIN_PASSWORD: 'y' }).stationKey,
    )
  })

  it('is a separate field from the admin password, and parts from it on request', () => {
    // Out of the box the two hold the same value, which is the point of the
    // default. What must stay true is that they are two settings and not one:
    // moving either has to leave the other alone, or a station that wanted
    // different codes for listening and for the decks could not have them.
    const shared = loadConfig({})
    expect(shared.stationKey).toBe(shared.adminPassword)

    const split = loadConfig({ ADMIN_PASSWORD: 'decks', STATION_KEY: 'door' })
    expect(split.adminPassword).toBe('decks')
    expect(split.stationKey).toBe('door')

    // And moving only one of them moves only one of them.
    const oneMoved = loadConfig({ ADMIN_PASSWORD: 'decks' })
    expect(oneMoved.adminPassword).toBe('decks')
    expect(oneMoved.stationKey).toBe(shared.stationKey)
  })

  it('is replaced by STATION_KEY when there is one', () => {
    expect(loadConfig({ ADMIN_PASSWORD: 'x', STATION_KEY: 'mine' }).stationKey).toBe('mine')
  })

  it('ignores a STATION_KEY that is only whitespace', () => {
    // Which is what a variable set to nothing in a compose file looks like.
    const config = loadConfig({ ADMIN_PASSWORD: 'x', STATION_KEY: '   ' })
    expect(config.stationKey).toBe(loadConfig({ ADMIN_PASSWORD: 'x' }).stationKey)
  })

  it('only comes off when somebody says so', () => {
    expect(loadConfig({ ADMIN_PASSWORD: 'x', STATION_OPEN: 'true' }).stationKey).toBeNull()
  })

  it('stays on for anything short of actually saying it', () => {
    // A half-set variable must not be the thing that publishes the station.
    for (const value of ['', ' ', 'yes', '1', 'TRUE', 'false']) {
      expect(
        loadConfig({ ADMIN_PASSWORD: 'x', STATION_OPEN: value }).stationKey,
        JSON.stringify(value),
      ).not.toBeNull()
    }
  })

  it('lets an explicit key win over an explicit opening, if both are set', () => {
    // Contradictory configuration, resolved towards the shut door: the mistake
    // you hear about from a friend who cannot get in, rather than from a
    // stranger who could.
    expect(
      loadConfig({ ADMIN_PASSWORD: 'x', STATION_KEY: 'mine', STATION_OPEN: 'true' }).stationKey,
    ).toBe('mine')
  })
})
