import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { hasAdminCredentials, mayListen } from '../src/lib/auth.js'

describe('loadConfig', () => {
  it('comes up with an admin password of its own when none is set', () => {
    // This used to throw. It now falls back to the house key, which is the one
    // thing an unconfigured station guards: listening is open, driving is not.
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
 * and a test that spelled it out would put it back, in a file that gets read
 * far more often than the one it was hidden in. So these pin the *behaviour*:
 * that there is a door, that you can change its lock, and that you have to say
 * so out loud to take the door off.
 */
describe('the station door', () => {
  it('is not there unless somebody puts one on', () => {
    // The default has been both ways round; this is the one that matters to a
    // listener. Nobody is asked for anything on the way in.
    expect(loadConfig({}).stationKey).toBeNull()
  })

  it('goes on when a key is set, with the whole mechanism intact behind it', () => {
    expect(loadConfig({ ADMIN_PASSWORD: 'x', STATION_KEY: 'mine' }).stationKey).toBe('mine')
  })

  it('stays off for a STATION_KEY that is only whitespace', () => {
    // Which is what a variable set to nothing in a compose file looks like, and
    // a door whose code is the empty string is not a door.
    expect(loadConfig({ ADMIN_PASSWORD: 'x', STATION_KEY: '   ' }).stationKey).toBeNull()
  })

  it('still takes STATION_OPEN without complaining, though it now says nothing', () => {
    // It is what taking the door off used to need. A compose file that has been
    // carrying it for months should not start failing to mean what it meant.
    for (const value of ['true', '', ' ', 'yes', 'false']) {
      expect(
        loadConfig({ ADMIN_PASSWORD: 'x', STATION_OPEN: value }).stationKey,
        JSON.stringify(value),
      ).toBeNull()
    }
  })

  it('admits a stranger, and still refuses that same stranger the decks', () => {
    // The composition, which is the property this default is actually about:
    // a real config, a caller with no cookie and no key, and the two answers
    // that have to differ. Opening the station means anybody can listen; it has
    // never meant anybody can play anything.
    const config = loadConfig({})
    expect(mayListen(config, {})).toBe(true)
    expect(hasAdminCredentials(config, {})).toBe(false)

    // And the door goes back on for a station that asks for one.
    expect(mayListen(loadConfig({ STATION_KEY: 'sesame' }), {})).toBe(false)
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

/**
 * The decks, which the door coming off did not touch.
 *
 * Opening the station means anybody can listen. It has never meant anybody can
 * upload, drive the decks or end the broadcast, and the whole point of keeping
 * these two as separate settings is that moving one leaves the other alone.
 */
describe('the admin password', () => {
  it('is there out of the box, even on a station with no door', () => {
    const config = loadConfig({})
    expect(config.adminPassword).not.toBe('')
    // The listening side is open and the decks are not. That is the shape.
    expect(config.stationKey).toBeNull()
  })

  it('is the same one every time, so a restart does not sign everyone out', () => {
    // The admin cookie is signed from this, so a value that moved between boots
    // would end every session on every deploy.
    expect(loadConfig({}).adminPassword).toBe(loadConfig({}).adminPassword)
  })

  it('is a separate setting from the door, and moving one leaves the other', () => {
    const split = loadConfig({ ADMIN_PASSWORD: 'decks', STATION_KEY: 'door' })
    expect(split.adminPassword).toBe('decks')
    expect(split.stationKey).toBe('door')

    const onlyDecks = loadConfig({ ADMIN_PASSWORD: 'decks' })
    expect(onlyDecks.adminPassword).toBe('decks')
    expect(onlyDecks.stationKey).toBeNull()

    const onlyDoor = loadConfig({ STATION_KEY: 'door' })
    expect(onlyDoor.stationKey).toBe('door')
    expect(onlyDoor.adminPassword).toBe(loadConfig({}).adminPassword)
  })
})
