import { createHash } from 'node:crypto'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../src/config.js'
import { PART_SIZE, mediaStore, partCountFor } from '../src/lib/store.js'

/**
 * The R2 path, against a real S3 server.
 *
 * Everything else in this suite runs the disk backend, which is correct — it is
 * what `npm run dev` and the compose stack use, and it implements the same
 * multipart protocol. But "the same protocol" is a claim, and the half that
 * cannot be checked against a directory is the half most likely to be wrong:
 * SigV4 signing, presigned URLs that a browser PUTs to without our
 * credentials, and S3's rules about part ordering and minimum part size.
 *
 * So this runs against **MinIO**, in a container, over the real S3 API. It is
 * not R2 — but the API is the one R2 implements, and the failures this catches
 * (a signature that does not verify, a completion whose parts are out of order,
 * a presigned URL that has the wrong host) are failures against both.
 *
 * Skipped, loudly, when there is no MinIO to talk to, so that `npm test` on a
 * machine without Docker is not a wall of red. Bring one up with:
 *
 *   docker run -d --name chunky-minio -p 9010:9000 \
 *     -e MINIO_ROOT_USER=chunkytest -e MINIO_ROOT_PASSWORD=chunkytest123 \
 *     quay.io/minio/minio server /data
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9010'
const BUCKET = 'chunky-podcast-test'
const KEYS = { accessKeyId: 'chunkytest', secretAccessKey: 'chunkytest123' }

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

const available = await reachable()

function storeFor(): ReturnType<typeof mediaStore> {
  return mediaStore({
    r2: {
      accountId: 'test',
      bucket: BUCKET,
      ...KEYS,
      publicBaseUrl: 'https://media.example.test',
      endpoint: ENDPOINT,
      forcePathStyle: true,
    },
  } as Config)
}

describe.skipIf(!available)('the R2 backend, against a real S3 API', () => {
  beforeAll(async () => {
    const client = new S3Client({
      region: 'auto',
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: KEYS,
    })
    try {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }))
    } catch {
      // Already there from a previous run, which is fine.
    }
  })

  afterAll(() => {
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn(`no S3 at ${ENDPOINT}: the R2 backend was not exercised`)
    }
  })

  it('addresses an object at the public base, not at the API', async () => {
    // What a listener is handed. It must be the CDN hostname rather than the
    // S3 endpoint: the whole point of R2 here is that video does not come
    // through this server, and a URL pointing at the API would quietly undo it.
    expect(storeFor().publicUrl('video/abc.mp4')).toBe('https://media.example.test/video/abc.mp4')
  })

  it('carries a multi-part upload end to end, through presigned URLs', async () => {
    const store = storeFor()
    // Two full parts and a short one, so this covers the case S3 is strictest
    // about: every part except the last must reach the 5 MiB floor.
    const data = Buffer.alloc(PART_SIZE * 2 + 1024, 7)
    const key = `masters/${createHash('sha256').update(data).digest('hex')}.wav`

    const begun = await store.createUpload(key, 'video/mp4')
    expect(begun.uploadId).toBeTruthy()
    expect(partCountFor(data.length)).toBe(3)

    // Uploaded the way the browser does: to a presigned URL, with no
    // credentials of its own. If the signature were wrong this is where it
    // would fail, and it is the thing a filesystem backend cannot check.
    const parts = []
    for (let n = 1; n <= 3; n++) {
      const url = await store.partUrl(begun.key, begun.uploadId, n)
      expect(url).toContain('X-Amz-Signature')

      const slice = data.subarray((n - 1) * PART_SIZE, n * PART_SIZE)
      const res = await fetch(url, { method: 'PUT', body: slice })
      expect(res.status, await res.text().catch(() => '')).toBe(200)

      const etag = res.headers.get('etag')
      expect(etag, 'the browser needs the ETag back, which needs CORS ExposeHeaders').toBeTruthy()
      parts.push({ partNumber: n, etag: etag as string })
    }

    // Deliberately out of order: the console collects receipts as parts finish,
    // which on a parallel upload is not the order they were sent in. The store
    // sorts them, and S3 refuses a completion that is not sorted.
    await store.completeUpload(begun.key, begun.uploadId, [...parts].reverse())

    expect(await store.size(key)).toBe(data.length)

    // And it reads back byte-identical, which is what says the parts were
    // assembled in the right order rather than merely all present.
    const chunks: Buffer[] = []
    for await (const chunk of await store.getStream(key)) chunks.push(chunk as Buffer)
    const round = Buffer.concat(chunks)
    expect(round.length).toBe(data.length)
    expect(createHash('sha256').update(round).digest('hex')).toBe(
      createHash('sha256').update(data).digest('hex'),
    )

    await store.remove(key)
    expect(await store.size(key)).toBeNull()
  })

  it('leaves nothing behind when an upload is abandoned', async () => {
    // A 500 MB upload the admin gave up on must not sit in the bucket being
    // charged for. R2 bills for incomplete multipart uploads exactly like
    // complete ones.
    const store = storeFor()
    const key = 'masters/abandoned.wav'
    const begun = await store.createUpload(key, 'video/mp4')

    const url = await store.partUrl(begun.key, begun.uploadId, 1)
    const res = await fetch(url, { method: 'PUT', body: Buffer.alloc(PART_SIZE, 3) })
    expect(res.status).toBe(200)

    await store.abortUpload(begun.key, begun.uploadId)
    expect(await store.size(key)).toBeNull()
  })

  it('puts and removes an object outright, which is what the encode does', async () => {
    const store = storeFor()
    const key = 'video/rewritten.mp4'
    await store.put(key, Buffer.from('not really h264'), 'video/mp4')
    expect(await store.size(key)).toBe(14)
    await store.remove(key)
    expect(await store.size(key)).toBeNull()
  })

  it('answers null for an object that is not there', async () => {
    // Rather than throwing, which is what the upload path relies on to decide
    // whether an assembly actually produced anything.
    expect(await storeFor().size('nothing/at/all.mp4')).toBeNull()
  })
})
