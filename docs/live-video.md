# Live video: streaming a DJ set from an iPhone

```
iPhone + mixer audio -> Larix -> MediaMTX on Railway -> HLS -> chunky.fm
```

When the phone starts publishing, the station notices within about ten seconds.
The landing page's hero becomes the video and the station page shows it above
the deck. When the phone stops, both go back on their own. There is no button.

The station asks by fetching the playlist (`server/src/video.ts`), so the two
services share no credentials.

## The video service

`chunky-video` is a separate Railway service, so a video problem cannot take the
station down. It is built from `video/Dockerfile` and redeployed with:

```sh
railway up ./video --path-as-root --service chunky-video
```

| | |
|---|---|
| Viewers fetch from | `https://chunky-video-production.up.railway.app` (port 8888) |
| The phone sends to | `centerbeam.proxy.rlwy.net:18983` (TCP proxy to port 1935) |
| Publish password | `MTX_AUTHINTERNALUSERS_1_PASS` on the service |

Read the password with:

```sh
railway variable list --service chunky-video
```

## Connecting the station (once)

The station service needs this variable, and the code from this branch deployed:

```
VIDEO_HLS_URL=https://chunky-video-production.up.railway.app/live/stream/index.m3u8
```

## The iPhone (once)

Install Larix Broadcaster and add a connection:

```
rtmp://centerbeam.proxy.rlwy.net:18983/live/stream?user=dj&pass=YOUR_PASSWORD
```

Set Target type to Default and leave Login and Password blank: the password is
in the address, and this server does not use Larix's RTMP authorization.

| Setting | Value |
|---|---|
| Codec | H.264, not HEVC |
| Video | 1920x1080, 30 fps, rear main camera |
| Bitrate | 4500 Kbps; drop to 720p at 2500 Kbps if viewers buffer |
| Keyframe interval | 2 seconds |
| Audio | AAC, 48 kHz, stereo, 160 Kbps or more |

Feed the mixer's output in through a USB audio interface and check that the app
is using that input and not the built-in mic.

## Going live

Start the stream in Larix, then open the site on another device and check it
yourself before telling anyone. Stop the stream to end.

Keep the phone on power and on Do Not Disturb. Light yourself well: a phone
camera in a dark booth looks grainy whatever the resolution.

## Worth knowing

- **The stream is public.** The landing page shows it to everyone, and
  `STATION_KEY` does not protect it.
- **Bandwidth is billed.** Railway charges per GB sent. A 3-hour set at 4.5 Mbps
  is about 6 GB per viewer, roughly $0.30 at $0.05/GB.
- **The password travels unencrypted** over plain RTMP. If it may have leaked,
  change the variable and redeploy the service.
- **Music rights:** nothing here scans your set, but that does not license it.
  Check what applies to you before playing commercial tracks publicly.
- **Viewers run several seconds behind you**, so chat replies will lag the music.

## Without Railway

`video/docker-compose.yml` runs the same server on a plain VPS, with Caddy for
HTTPS. Copy `video/` over, fill in `video/.env` from `.env.example`, and run
`docker compose up -d`. The phone then uses
`rtmp://your-domain/live/stream?user=dj&pass=...` with no port.
