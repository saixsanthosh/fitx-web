# The film lab and render pipeline

FITX's films (the visitor intro and the welcome film) are procedural 3D scenes rendered in the browser
(`src/components/brand/intro/`). The site plays pre-rendered cuts of them. This folder turns the live scene into
those cuts:

| Step | Script | Output (outside the repo) |
|---|---|---|
| Render exact frames through the lab page `/lab/film` | `render.mjs` | FFV1 masters, `.alteration/renders/<job>/<rev8>/<comp>-<theme>/master.mkv` |
| Encode the rungs | `encode.mjs` | `<comp>-<theme>-hevc60.mp4`, `-avc30.mp4`, `<comp>-<theme>.webp` next to the master |
| Check them | `verify.mjs` | JSON on stdout (exit 1 when a check fails) |
| Share the browser lane | `lane.mjs` | the `.redesign/checks/.e2e-lock` lock |

Only the coordinator runs final renders and encodes (S6, overnight) and commits their outputs
(`public/brand/films/**`, `cuts.generated.ts`). Streams run previews.

## Preconditions

- System Chrome at `/Applications/Google Chrome.app` with a GPU path. Headless Chrome on this Mac renders on Metal
  (`ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)`). A software renderer (SwiftShader, llvmpipe)
  aborts the job; `--headed` is the fallback.
- playwright-core at `E2E_PLAYWRIGHT_CORE`, default
  `worktrees/.redesign/tools/node_modules/playwright-core/index.mjs` (outside the repo; loaded through
  `loadPlaywright` in `tests/e2e/support/browser.mjs`). No npm package is added.
- Homebrew ffmpeg (8.1.1 here) with `scale`, `setparams`, `tmix`, `ssim`, `psnr`, `ebur128`, `loudnorm`, `freezedetect`,
  `blackdetect`, `vflip`, the `framemd5` muxer and the `libx265`, `libx264` and `ffv1` encoders. This build has no
  libzimg, so nothing uses `zscale`: colour conversion is swscale's `out_color_matrix=bt709:out_range=tv`.
- `cwebp` (Homebrew libwebp) for posters and stills: this ffmpeg has no WebP encoder.
- At least 12 GB free on the volume (one composition's 1080p FFV1 master is about 1.7 GB for 715 frames).
- No `rcheck`, `e2e.sh` or `next build` running **in the same worktree** (the lab's `next dev` shares `.next`).

**Preflight** (`render.mjs --preflight`, and at the start of every job, written to the job's `job.log`) checks all of
the above and records the ffmpeg build string and the GPU renderer string.

```sh
heavy.sh node scripts/brand/films/render.mjs --preflight
```

## The browser lane

Everything that drives Chrome or encodes video takes one lock, `.redesign/checks/.e2e-lock`, one job at a time on the
machine (BRIEF-2 1.3). `lane.mjs` implements e2e.sh's pattern once:

1. Started through `heavy.sh`, a job **gives its heavy slot back** before it queues (only when the slot's `pid` is its
   parent), so a waiting job holds no CPU slot.
2. It waits for the lock (15 s polls, four hours at most). A lock is stale when its owner's PID has exited or the
   directory is older than 120 minutes.
3. Holding the lock, it runs the actual work (`next dev`, Chrome, ffmpeg) as a second copy of itself under a **fresh
   heavy.sh slot** (`FITX_LANE_INNER=1`).
4. **Keep-alive:** the lock directory is touched after every shot segment and every encode, and by a timer at least
   every 5 minutes, so a 2.5 h overnight pass never goes stale. `pid` and `job` (kind, label, start time) sit in it.
5. It removes the lock on exit, SIGINT and SIGTERM, but only while the lock is still its own.

Daytime lane jobs last at most 60 minutes; a preview is `--step=30` (2 fps) on one composition and one theme. Never run
`next build` in the other heavy slot during a lane job (memory).

## Rendering (`render.mjs`)

```sh
heavy.sh node scripts/brand/films/render.mjs --job=intro --comp=laptop --theme=dark            # a whole master
heavy.sh node scripts/brand/films/render.mjs --job=intro --comp=phone --theme=light --step=30  # a 2 fps preview
heavy.sh node scripts/brand/films/render.mjs --job=welcome --comp=desktop --theme=dark --shots=w4-crane
```

Flags: `--job=intro|welcome|landing-reel|login-stills`, `--comp=<list>`, `--theme=<list>`, `--frames=<first>-<last>`
(inclusive), `--pick=<frames in order>`, `--shots=<ids>`, `--step=<n>`, `--ss=<1..3>` (supersampling: render at n× and
scale down with lanczos), `--subframes=<1..4>` (motion blur: n samples inside each 1/60 s averaged with `tmix`, never
across a cut), `--rev=<id>`, `--out=<dir>`, `--label=<text>`, `--headed`, `--port=<n>` (default 3790), `--preflight`.

How a frame is made:

- `next dev` with `FITX_LAB=1` on `127.0.0.1:<port>`; Chrome opens `http://fitx-lab.localhost:<port>/lab/film`
  (`*.localhost` is an allowed dev origin by default). The page 404s in production builds and without `FITX_LAB=1`, and
  is `noindex`.
- `window.__fitxLab.load({ film, comp, theme, width, height, ss, sink })` builds `createFilmDirector` from `FILM_DEFS`
  with `lab: true`, `quality: LAB_QUALITY` (MSAA 4, shadows 2048, DOF on, every particle, dpr 1) and a fixed `size`, so
  the drawing buffer is exactly the frame size whatever the window. A frame whose characters are not ready throws (no
  silent skip). One warm-up seek per shot.
- `frame(t)`: the director renders film time `t`; in the same task `readPixels` copies the frame, and the page POSTs the
  raw RGBA to the driver's `127.0.0.1` sink (the context bypasses the page's CSP for that one local address). The sink
  pipes it into ffmpeg: `vflip`, optional `tmix`, then
  `scale=<w>:<h>:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv444p10le,setparams=bt709…` into an FFV1
  segment per shot.
- **Resumable:** a segment whose `.json` marker matches the request is skipped, so a stopped job restarts where it was.
  The segments are joined losslessly into `master.mkv`, with `master.framemd5` beside it.
- One composition's masters on disk at a time: starting a composition removes the masters of other compositions of
  the same rev that `encode.mjs` has finished with (`encoded.json`).
- `rev` (`<rev8>`) hashes the film's source tree (`src/components/brand/intro/**`, `compositions.ts`, the lab), the job
  arguments that change pictures, and the encoder settings.
- `summary-<label>.json` records seconds per frame, peak memory (the job's whole process tree) and the GPU string.

### The jobs

- `intro`, `welcome`: 60 fps, `round(duration × 60)` frames (756 for the 12.6 s intro, 720 for the welcome film), each
  composition at its render size (`COMPOSITIONS`).
- `landing-reel`: the landing hero reel (`src/components/landing/film.ts`): intro film time 1.3 to 10.6 s at 30 fps,
  279 frames, in the two shapes the landing serves: `landscape` 1280×720 (the laptop composition) and `portrait`
  540×960 (the phone composition), rendered at 2× and scaled down. It also writes the posters
  (`poster-<theme>-landscape.webp` 1600×900 and `poster-<theme>-portrait.webp` 720×1280, film time 2.05 s) and
  `team-<theme>.webp` (1600×900, the team walk at 9.9 s). Those times were recovered by matching the shipped stills
  against every frame of the shipped 60 fps cuts (mean squared error 1.3, 3.7 and 1.1 on 8-bit grey at 160 px, against
  90 to 200 for the neighbouring frames). The reel masters are then encoded as today's reels (H.264 30 fps).
  S6 (2026-11-24, rev `3b29b285`) re-cut the shipped reels, posters and team stills from the refined intro: the same
  sizes, 279 frames, CRF and keyint, now tagged BT.709 tv.
- `login-stills`: the sign-in scene's stills (`public/media/login/still-<theme>-{wide,tall}.webp`, 1600×800 and
  1000×1100). It opens `/signin` in the lab's `next dev`, pins the scene's host to the still's exact size, calls the
  scene's development hook `window.__fitxLoginScene.freeze(5)` (`STILL_SECONDS`) and reads the canvas in the same task,
  then `cwebp`. (Cut first if time runs short: BRIEF-2 7.2 item 1.)

## Encoding (`encode.mjs`)

```sh
heavy.sh node scripts/brand/films/encode.mjs --master=<dir>/laptop-dark/master.mkv --comp=laptop --theme=dark --budget
```

| Rung | Settings |
|---|---|
| `hevc60` | x265 `slow`, CRF from 29 stepped to fit 3.4 MB with `--budget`, keyint 60, level 4.1 high tier, VBV 50000/50000, `pools=4`, `hvc1`; no tune by default (`--tune=grain` doubles the bytes, measured below) |
| `avc30` | x264 `slow`, High, CRF from 27 stepped to fit 1.6 MB with `--budget`, keyint 30, every other frame, 0.75× size (720×1440, 900×1200, 1200×900, 1440×810, 1440×720) |
| poster | frame 0 → PNG → `cwebp -q 82` (down in steps of 6 until under 50 KB) |
| `reel` (`--comp=landscape\|portrait --theme=…`) | the landing reel as shipped: x264 slow, High, CRF 29 landscape / 27 portrait, keyint 250, now tagged BT.709 tv |

All files: `+faststart`, BT.709 primaries, transfer and matrix, tv range. `--legacy` makes the old pipeline's HEVC
(below) for gate A.

Measured on gate A's master (today's 11.9 s film, laptop, dark; 2026-11-23): `hevc60` slow with no tune at crf 29 is
3.08 MiB (SSIM 0.972 to the master, 4 min); with `--tune grain` crf 29 is 5.79 MiB and crf 32 still 3.98 MiB (SSIM 0.967),
about 7 minutes per try. `avc30` (1440×810) at crf 27 is 2.52 MiB, over its 1.6 MiB cap; `--budget` stepped it to crf
32, 1.47 MiB (crf 31 was 1.64 MiB), about 1 minute per try. The poster is 43 KB at q 82. (Sizes here are MiB; the
budgets in `lib/encoders.mjs` are decimal bytes, the caps `tests/brand/film-manifest.test.ts` holds: 3,400,000 for
`hevc60`, 1,600,000 for `avc30`, 50,000 for a poster.)

## Verifying (`verify.mjs`)

- `--cut=<mp4> --film=intro --comp=laptop --rung=hevc60 [--sha256=…] [--fades=10.6-12.6]`: codec, profile, level (HEVC
  ≤ 4.1, H.264 ≤ 4.2), frame count (756 or 720; half for `avc30`), fps, the BT.709 tv tags, `yuv420p`, `hvc1`, `moov`
  before `mdat`, SHA-256, and `freezedetect`/`blackdetect` outside the authored fades and holds.
- `--mix=<m4a> --duration=12.6 [--sting]`: `ebur128` I −16 ± 1 LUFS (not the sting), TP ≤ −1 dBTP, length ± 10 ms.
- `--compare=<a> --against=<b> [--a-matrix] [--b-matrix]`: SSIM and PSNR after bringing both to BT.709 4:2:0.
- `--determinism=<re-render> --against=<master> --pick=<frames>`: each re-rendered frame against the first render,
  PSNR ≥ 55 dB.
- `--contact=<video> --comp=<c>`: 2 fps contact sheets with the protected box drawn on (yellow).
- `--framing --film=<f> --comp=<c> --theme=<t> [--available=…] [--zones=<json>]` (takes the lane): the lab's
  `project()` at every 6th frame and each cut ± 1; every `must` subject box inside the protected box (visible at every
  served band's real edges, shrunk 9% a side) and outside the zones. Shots report "no subjects() yet" until film-intro
  and film-welcome add `ShotModule.subjects`.

## The shipped cuts' settings (recovered for gate A)

Read on 2026-11-23 from `public/brand/intro/*` with ffprobe and the encoders' SEI strings (all through libavcodec
62.28.101 / libavformat 62.12.101):

- **HEVC 60** (`-60.hevc.mp4`): 1920×1080 (portrait 1080×1920), 715 frames, 60/1, 11.917 s, Main, level 4.1 high tier,
  `hvc1`; x265 4.2 with the **medium** preset's analysis (`rd=3 subme=2 me=1 ref=3 rc-lookahead=20`), `crf=29`,
  `keyint=120 min-keyint=60`, `bframes=4`, `aq-mode=2`, `psy-rd=2.00`, `vbv-maxrate=50000 vbv-bufsize=50000`;
  colour primaries, transfer and matrix untagged (2 = unspecified), range tv; 1.87 Mb/s.
- **H.264 60** (`-60.mp4`): High, level 4.2, x264 core 165 with the **slow** preset (`subme=8 trellis=2
  rc_lookahead=50`, `ref` 5 capped to 4 by the level, medium's `me=hex b_adapt=1`), `crf=27`, `keyint=120 keyint_min=12`;
  untagged; 3.36 Mb/s.
- **H.264 30** (`-30.mp4`): 960×540 (portrait 540×960), 358 frames, level 3.0, the slow preset, `crf=29`,
  `keyint=60 keyint_min=6`, `ref=3` (level cap); untagged.
- **Landing reels** (`public/media/landing-film/reel-*.mp4`): 1280×720 and 540×960, 279 frames at 30 fps, High, level
  3.1, the slow preset, `crf=29` (landscape) and `crf=27` (portrait), ffmpeg's default keyint 250; untagged.
- Masters were converted from RGB **without** a colour matrix, so ffmpeg's default applied: BT.601, limited range (the
  shipped files decode correctly only as BT.601).
- Frames: 715 = film time 0 to 11.9 s inclusive, at `t = n / 60` (the memory notes: the old lab "seeked at 60 fps").
- Not in the files: dpr, MSAA, sub-frames and the quality tier. Gate A's first try (dpr 1, MSAA 4, no sub-frames:
  `LAB_QUALITY`) is what the shipped tier gives at 1920×1080 on this Mac (the high tier's 2.4 MP budget gives dpr 1).

## Gate A

Re-render today's film (11.9 s, 715 frames) at 1920×1080, dark, through the lab, and compare with the shipped
`fitx-intro-dark-landscape-60.hevc.mp4` (BRIEF-2 1.2):

```sh
heavy.sh node scripts/brand/films/render.mjs --job=intro --comp=laptop --theme=dark --frames=0-714 --rev=gate-a-v1
heavy.sh node scripts/brand/films/encode.mjs --master=$R/intro/gate-a-v1/laptop-dark/master.mkv --legacy
heavy.sh node scripts/brand/films/verify.mjs --compare=$R/intro/gate-a-v1/laptop-dark/laptop-dark-legacy-hevc60.mp4 \
  --a-matrix=bt601 --against=public/brand/intro/fitx-intro-dark-landscape-60.hevc.mp4 --b-matrix=bt601
heavy.sh node scripts/brand/films/render.mjs --job=intro --comp=laptop --theme=dark --rev=gate-a-det --pick=<24 frames>
heavy.sh node scripts/brand/films/verify.mjs --determinism=$R/intro/gate-a-det/laptop-dark/master.mkv \
  --against=$R/intro/gate-a-v1/laptop-dark/master.mkv --pick=<the same 24 frames>
```

Pass: SSIM ≥ 0.97. Fallback A′: the lab is deterministic (24 frames re-rendered out of order, each ≥ 55 dB) and the
owner approves a side-by-side by eye. The measured results are in the film-lab report
(`.alteration/reports-2/film-lab.md`).
