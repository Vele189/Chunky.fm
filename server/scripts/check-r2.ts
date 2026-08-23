/**
 * Is this station's object storage actually usable?
 *
 * Run before wondering why an upload failed:
 *
 *     npm run check:r2
 *
 * It answers the four questions that account for essentially every R2
 * misconfiguration, in the order they bite:
 *
 *   1. Are all five variables set? (Four is the commonest state, and the app
 *      refuses to boot on it rather than half-working.)
 *   2. Do the credentials open the bucket?
 *   3. **Can they write?** This is the one that is easy to get wrong and hard to
 *      diagnose from the app: an "Object Read only" API token passes every
 *      connection check and then fails the first upload with `AccessDenied`.
 *   4. Does a presigned URL work from outside — which is what the browser
 *      actually does, with no credentials of its own?
 *
 * Everything it creates, it deletes. It writes one 6 MiB object, because R2
 * requires every multipart part except the last to reach 5 MiB and a smaller
 * test would not exercise the path an episode takes.
 *
 * What it deliberately cannot check is CORS, because CORS is a rule about
 * *browsers* and this is not one. If uploads reach 100% and then fail, that is
 * the thing to look at; see `.env.example`.
 */
import { randomUUID } from 'node:crypto'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * The variables, read raw rather than through `loadConfig`.
 *
 * Deliberate, and it is the difference between a diagnostic and a second copy
 * of the thing being diagnosed. `loadConfig` enforces all-or-none and throws on
 * four of five — which is correct for booting a station and useless here, since
 * a half-configured station is exactly when somebody runs this. So the rule is
 * *reported* rather than enforced, and everything that can still be checked is.
 */
const RAW = {
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID?.trim() ?? '',
  R2_BUCKET: process.env.R2_BUCKET?.trim() ?? '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID?.trim() ?? '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '',
  R2_PUBLIC_BASE_URL: (process.env.R2_PUBLIC_BASE_URL?.trim() ?? '').replace(/\/+$/, ''),
  R2_ENDPOINT: process.env.R2_ENDPOINT?.trim() ?? '',
}

const tick = (message: string) => console.log(`  ✓ ${message}`)
const cross = (message: string) => {
  console.log(`  ✗ ${message}`)
  process.exitCode = 1
}

/** Never print a secret. The first few characters are enough to tell two apart. */
const hint = (value: string) => `${value.slice(0, 6)}… (${value.length} chars)`

const REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BASE_URL',
] as const

const missing = REQUIRED.filter((name) => RAW[name] === '')

if (missing.length === REQUIRED.length) {
  console.log('R2 is not configured: this station keeps its archive on disk.')
  console.log('\nThat is a supported way to run this. To use R2, set the five')
  console.log('R2_* variables in server/.env; see .env.example.')
  process.exit(0)
}

// The credentials are enough to test the storage even when the *serving* half
// is not set yet, so say what is missing and carry on rather than stopping.
if (missing.length > 0) {
  console.log(`! ${missing.join(', ')} not set — the station will refuse to boot until ${
    missing.length === 1 ? 'it is' : 'they are'
  }.`)
  console.log('  Checking everything else anyway.\n')
}

const canConnect = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
  .every((name) => RAW[name as keyof typeof RAW] !== '')
if (!canConnect) {
  console.log('Not enough to reach the bucket. Set the four credential variables first.')
  process.exit(1)
}

const r2 = {
  accountId: RAW.R2_ACCOUNT_ID,
  bucket: RAW.R2_BUCKET,
  accessKeyId: RAW.R2_ACCESS_KEY_ID,
  secretAccessKey: RAW.R2_SECRET_ACCESS_KEY,
  publicBaseUrl: RAW.R2_PUBLIC_BASE_URL,
  endpoint: RAW.R2_ENDPOINT || null,
  forcePathStyle: RAW.R2_ENDPOINT !== '',
}
const endpoint = r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`
console.log(`bucket   ${r2.bucket}`)
console.log(`endpoint ${endpoint}`)
console.log(`account  ${hint(r2.accountId)}`)
console.log(`key id   ${hint(r2.accessKeyId)}`)
console.log(`public   ${r2.publicBaseUrl || '(not set)'}\n`)

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: r2.forcePathStyle,
  credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
})

// --- can we see it? ---------------------------------------------------------
try {
  await s3.send(new HeadBucketCommand({ Bucket: r2.bucket }))
  tick('the credentials work and the bucket exists')
} catch (err) {
  cross(`cannot reach the bucket: ${(err as Error).name}`)
  console.log('\n    Check R2_ACCOUNT_ID and R2_BUCKET, and that the API token')
  console.log('    is scoped to this bucket (or to all of them).')
  process.exit(1)
}

try {
  const listing = await s3.send(new ListObjectsV2Command({ Bucket: r2.bucket, MaxKeys: 1000 }))
  const objects = listing.Contents ?? []
  const bytes = objects.reduce((total, object) => total + (object.Size ?? 0), 0)
  tick(`readable: ${objects.length} object(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`)
} catch (err) {
  cross(`cannot list the bucket: ${(err as Error).name}`)
}

// --- can we write? ----------------------------------------------------------
//
// The whole reason this script exists. Everything above passes with a read-only
// token, and then every upload fails.
const key = `masters/_check-${randomUUID()}.bin`
let uploadId: string | undefined

try {
  const begun = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: r2.bucket, Key: key }),
  )
  uploadId = begun.UploadId
  tick('writable: a multipart upload can be begun')
} catch (err) {
  cross(`cannot write: ${(err as Error).name}`)
  console.log('\n    This is almost always a read-only API token. In the Cloudflare')
  console.log('    dashboard: R2 → Manage API Tokens → the token → Permissions,')
  console.log('    which must be "Object Read & Write" rather than "Object Read only".')
  console.log('    Creating a new token issues new keys; update server/.env with both.')
  process.exit(1)
}

try {
  const url = await getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: r2.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: 1,
    }),
    { expiresIn: 600 },
  )
  tick(`a presigned part URL can be minted (host ${new URL(url).host})`)

  // Uploaded with no credentials at all, which is what the browser does.
  const body = new Uint8Array(6 * 1024 * 1024).fill(42)
  const response = await fetch(url, { method: 'PUT', body })
  if (!response.ok) throw new Error(`the store answered ${response.status}`)

  const etag = response.headers.get('etag')
  if (!etag) throw new Error('no ETag came back')
  tick('6 MiB uploaded straight to the store, unauthenticated, and acknowledged')

  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: r2.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: etag }] },
    }),
  )
  uploadId = undefined

  const head = await s3.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }))
  if (head.ContentLength === body.length) tick('assembled at the right size')
  else cross(`assembled at ${head.ContentLength} bytes, expected ${body.length}`)
} catch (err) {
  cross(`the upload path failed: ${(err as Error).message}`)
} finally {
  if (uploadId) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: r2.bucket, Key: key, UploadId: uploadId }))
      .catch(() => undefined)
  }
  await s3.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })).catch(() => undefined)
  tick('everything this check created has been deleted')
}

if (missing.length > 0) {
  console.log(`\nStill to set: ${missing.join(', ')}.`)
  if (missing.includes('R2_PUBLIC_BASE_URL')) {
    console.log('\nR2_PUBLIC_BASE_URL is where *listeners* fetch audio from, which is')
    console.log('not the S3 endpoint above — that one needs credentials. In the')
    console.log('Cloudflare dashboard: R2 → the bucket → Settings → Public access,')
    console.log('either by connecting a custom domain (media.yourdomain.com) or by')
    console.log('enabling the r2.dev subdomain, which gives you a pub-….r2.dev URL.')
  }
} else if (process.exitCode) {
  console.log('\nSomething above needs fixing before an episode can be uploaded.')
} else {
  console.log('\nR2 is ready. Uploads will go straight from the browser to the bucket.')
  console.log('One thing this cannot check from here: the bucket’s CORS policy needs')
  console.log('ExposeHeaders: ["ETag"], or uploads reach 100% and then fail.')
}
