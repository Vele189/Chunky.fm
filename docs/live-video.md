# Live video: streaming a DJ set to the site

```
camera + mixer -> OBS -> MediaMTX on a VPS -> HLS -> chunky.fm
```

When OBS starts publishing, the station notices within about ten seconds. The
landing page's hero becomes the video and the station page shows it above the
deck. When OBS stops, both go back on their own. There is no button.

The station asks by fetching the playlist (`server/src/video.ts`), so the two
machines share no credentials. The video goes straight from the VPS to viewers
and never passes through Railway.

## 1. The video server (once)

You need a small Linux VPS with Docker and a few TB of monthly bandwidth
included. At 3 Mbps, 30 viewers use about 40 GB an hour.

1. Point a DNS name at it, such as `live.your-station.example`.
2. Open ports 80, 443 and 1935.
3. Copy the `video/` folder to it, then:

   ```sh
   cp .env.example .env    # fill in VIDEO_DOMAIN and PUBLISH_PASSWORD
   docker compose up -d
   ```

## 2. The station (once)

On Railway, set this variable and redeploy:

```
VIDEO_HLS_URL=https://live.your-station.example/live/index.m3u8
```

## 3. OBS (once)

Settings -> Stream, Service: Custom

- **Server:** `rtmp://live.your-station.example`
- **Stream key:** `live?user=dj&pass=YOUR_PUBLISH_PASSWORD`

Settings -> Output, Output Mode: Advanced

- **Encoder:** x264 or your GPU's H.264 encoder (not HEVC or AV1)
- **Rate control:** CBR, 2500-3500 Kbps
- **Keyframe interval:** 2 seconds

Settings -> Video: 1280x720, 30 fps. Audio: 48 kHz, stereo, AAC.

Add the camera as a Video Capture Device, and the mixer's output through an
audio interface as an Audio Input Capture. Mute Desktop Audio and any camera
mic, so the only thing viewers hear is the mix.

## Going live

Press Start Streaming, then open the site and check it yourself before telling
anyone. Press Stop Streaming to end.

## Worth knowing

- **The stream is public.** The landing page shows it to everyone, and
  `STATION_KEY` does not protect it.
- **The stream key travels unencrypted** over plain RTMP. If it may have leaked,
  change `PUBLISH_PASSWORD` and restart the video server.
- **Music rights:** nothing here scans your set, but that does not license it.
  Check what applies to you before playing commercial tracks publicly.
- **Viewers run several seconds behind you**, so chat replies will lag the music.
