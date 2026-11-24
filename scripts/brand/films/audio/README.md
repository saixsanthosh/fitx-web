# FITX film audio

The sound of the intro film, the welcome film and the returning sign-in sting (BRIEF-2 3.4). ffmpeg only, on the CPU:
run every command through `worktrees/heavy.sh`, never in the browser lane. Node 24 runs these files directly; add
`--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to hide the warning about the `.ts` timelines they import.

| File | What it is |
| --- | --- |
| `sources.json` | The six owner-approved Pixabay originals: file, size, SHA-256, length and the measured **anchor** (the moment a cue lines up with the film). |
| `intro.cues.mjs` | The intro's cues, from `STAGE_START`, `SHOTS`, `FILM_DURATION` and the mark's CSS plate timing. |
| `welcome.cues.mjs` | The welcome film's cues, from the welcome timeline (`WELCOME_DURATION`, `WELCOME_BEATS`). |
| `sting.cues.mjs` | The returning-reveal sting: 1.2 s of impact #6. |
| `lib.mjs` | Pure helpers: spans, validation, the ffmpeg graph, meter parsing, onset scan. |
| `io.mjs`, `sources.mjs` | Source checks against `.alteration/audio/CREDITS.md`, ffmpeg calls. |
| `analyse.mjs` | Measures the anchors and loudness of the originals; `--check` fails when an anchor moved. |
| `mix.mjs` | Makes the preview mixes (owner's listen-through) or the finals (S6). |

The originals stay in `.alteration/audio/raw/` (outside the repository) and are never copied in. Only the finished `.m4a`
mixes ship, and only S6 commits them.

## Commands

```sh
# Measure the anchors (and check sources.json still matches them):
worktrees/heavy.sh node scripts/brand/films/audio/analyse.mjs --check

# Preview mixes for the owner (to .alteration/audio/previews/): intro.m4a, welcome.m4a, sting.m4a, a *-preview.mp4 for
# each (the film's picture when one exists, with a timing strip under it) and summary.json:
worktrees/heavy.sh node scripts/brand/films/audio/mix.mjs --preview --intro-duration=12.6 \
  [--video=intro=<2 fps preview.mp4>] [--video=welcome=<animatic.mp4>]

# Finals (S6, coordinator only), into public/brand/films/<film>/<rev8>/sound.m4a and public/brand/films/return/<rev8>/sting.m4a,
# printing the FilmAudio entries ({ src, bytes, sha256, lufs, duration }) for cuts.generated.ts:
worktrees/heavy.sh node scripts/brand/films/audio/mix.mjs --final --rev=intro=<rev8> --rev=welcome=<rev8> --json=<file>
```

Other options: `--films=intro,welcome,sting`, `--audio-dir=<.alteration/audio>`, `--out=<dir>`, `--work=<dir>` with
`--keep` (keeps the temporary WAVs), `--dry-run` (prints the resolved sheets and filter graphs).

## How a mix is made

1. Every original is checked against `sources.json` and `CREDITS.md` (size and SHA-256); a mismatch stops the run.
2. **Levelling** (two passes): loudnorm measures each cue's segment (after its trim and low-pass), then the linear gain
   to −23 LUFS is applied as `volume` in the mix graph (what loudnorm's linear pass does, without its 192 kHz round
   trip, so each cue stays sample-exact).
3. **Placement:** `atrim`, `afade`, `volume` (levelling plus the cue's own `gainDb`), `adelay`, then `amix` without
   normalisation; padded or cut to the film length to the sample.
4. **Mastering:** a gain to −16 LUFS (films) or −20 LUFS (sting); a 4× oversampled limiter only when a true peak would
   pass −1.5 dBTP; repeated until within 0.2 LU.
5. **Encoding:** AAC-LC 128 kbps, 48 kHz stereo, bit-exact, no metadata, faststart. The decoded file is checked:
   I within ± 1 LU, true peak ≤ −1 dBTP (the limiter drops 0.5 dB and retries if AAC pushed it over), length within
   ± 10 ms (the length the container declares, which is what browsers play), at most 300 KB (films) or 40 KB (sting).
   `summary.json` also records where each transient cue's onset landed (`sync`, in ms) and how much the limiter took.

## Accents from the films' timelines

- Intro: the plate seating in `3a-plate` and the bar meeting the platform in `3d-drop` come from
  `INTRO_SOUND_ACCENTS = { plateSeat, barDrop }` in `intro/timeline.ts`: 5.3 s and 7.383 s (frames 318 and 443),
  measured from the shots' own motion; `tests/brand/intro-sound-accents.test.ts` measures them again. Without that
  export the sheet would fall back to 5.38 s and 7.30 s.
- Welcome: the plate sounds sit on the beats the loading shots play, imported from `WELCOME_BEATS` in the welcome
  `timeline.ts` (each a measured hit of score #5): #3's clang where each plate meets the stack (`plateSeat`: 2.4, 4.48
  and 5.86 s), and #4, Dre's lock, on his plate's after-tap (`settle[2]`: 6.12 s), so his slide leads the lock by
  0.26 s. Maya's and Leo's after-taps (`settle` 3.6 and 4.71 s) have no cue.
- The film-end plates follow `.fitx-mark__piece--plate-N` in `src/app/globals.css`; `tests/brand/film-cues.test.ts`
  fails if the CSS and `REVEAL_PLATES` drift apart.
