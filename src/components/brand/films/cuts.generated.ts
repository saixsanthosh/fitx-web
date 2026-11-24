/**
 * The films' encoded cuts, posters and sound (BRIEF-2 3.1). Written by S6, the coordinator's final render pass, from
 * encode.mjs and mix.mjs: codec strings read from each file's own hvcC/avcC box, size and frame rate from ffprobe, bytes
 * and SHA-256 from the files under public/brand/films/<film>/<rev8>/. Regenerate it with the next final pass; never edit
 * it by hand.
 */
import type { FilmAudio, FilmManifests } from "./manifest";

/** Every committed poster with its size and hash, for tests/brand/film-manifest.test.ts. */
export const FILM_POSTER_FILES: ReadonlyArray<{ src: string; bytes: number; sha256: string }> = [
  { src: "/brand/films/intro/9f45eed7/phone-dark.webp", bytes: 38536, sha256: "a83e3390951e38ebd62af93c83c5f3ff219c66ff6b797ff9dd9151f2fe1c2454" },
  { src: "/brand/films/intro/9f45eed7/phone-light.webp", bytes: 38590, sha256: "a422e4dd351d10ad45aa548b104bad5b611874c47a93cf2a4f898cc6abc97423" },
  { src: "/brand/films/intro/9f45eed7/tablet-p-dark.webp", bytes: 36912, sha256: "88906a58f5eb2bd400cbd06e9b4877a339bb60a68b650b8656d1b5b240b449cc" },
  { src: "/brand/films/intro/9f45eed7/tablet-p-light.webp", bytes: 38062, sha256: "00117a6d655b59684382fdd508d6f6d533b924498833c91d82103c0fe7438a49" },
  { src: "/brand/films/intro/9f45eed7/tablet-l-dark.webp", bytes: 39678, sha256: "12bb69a7a423deee9a51897e9b786b22b92196825123be8d6d8e1f33528e4c0d" },
  { src: "/brand/films/intro/9f45eed7/tablet-l-light.webp", bytes: 40604, sha256: "eb0ef0d1a2d8e074deecc43512321a9174ba8addc9f8fde8d4ca3248dac32d19" },
  { src: "/brand/films/intro/9f45eed7/laptop-dark.webp", bytes: 42876, sha256: "e85d95b709f496ae7eb4b7f9f1bd703ae1473fbeb4cb241675340c4f8630e756" },
  { src: "/brand/films/intro/9f45eed7/laptop-light.webp", bytes: 46248, sha256: "e05ad5648bfe0ec68fb476da373ad13385b9c8ce5e8c815bbb17417bde7a9d88" },
  { src: "/brand/films/intro/9f45eed7/desktop-dark.webp", bytes: 40142, sha256: "dd89e48979f4ab008ad1f05cae73f6356928b2a3835dd9041be0014085360d4f" },
  { src: "/brand/films/intro/9f45eed7/desktop-light.webp", bytes: 41628, sha256: "577e2b4f6ebe10a0f455208ce467fc1a2dedce7f03dfd09cb8ce89075b8cb1f4" },
  { src: "/brand/films/welcome/97d9ab68/phone-dark.webp", bytes: 6336, sha256: "0665309870b9acbc50e14ab682a2804a0a405e660f990d846cf73f264b3ddc0e" },
  { src: "/brand/films/welcome/97d9ab68/phone-light.webp", bytes: 6532, sha256: "390493d0908765f0b944945ecedcd932f2828bf18546140cd67003661bcd7c19" },
  { src: "/brand/films/welcome/97d9ab68/tablet-p-dark.webp", bytes: 6532, sha256: "ec48437627c7811913572476eae09f9e476f58daf8be3492c5d301749092e9ba" },
  { src: "/brand/films/welcome/97d9ab68/tablet-p-light.webp", bytes: 6982, sha256: "ed9cd6eb1c28cb30f8d1f6fafc61c513c986f09a9ca75105420a9fe035b07878" },
  { src: "/brand/films/welcome/97d9ab68/tablet-l-dark.webp", bytes: 6262, sha256: "123dd9edec48c570a888f7333bf427a84ed4043d841ac928a8da20fc381834b7" },
  { src: "/brand/films/welcome/97d9ab68/tablet-l-light.webp", bytes: 7046, sha256: "d5f60bae38f8c8c1a55bee693766438d13dfbe639a7a11af51a88bccaa436475" },
  { src: "/brand/films/welcome/97d9ab68/laptop-dark.webp", bytes: 6714, sha256: "15975f5087e37f56577072c6592b5c6ef22269ff567d353bcbb29363beefc6fe" },
  { src: "/brand/films/welcome/97d9ab68/laptop-light.webp", bytes: 7442, sha256: "c1ddb8d520130b02fd40c15da9f625f152094f4871e87862c742eb92db200e9b" },
  { src: "/brand/films/welcome/97d9ab68/desktop-dark.webp", bytes: 6104, sha256: "6aedc69548161bc21f7dd07ca010e0e6ceecb3ffaf3f7efff7fd2fd78f8c9ae7" },
  { src: "/brand/films/welcome/97d9ab68/desktop-light.webp", bytes: 6870, sha256: "51d7b95ed4fddb57776f210c2411754ec5bc74b073ea9c2c878f19763f1ad455" },
];

export const FILM_MANIFESTS: FilmManifests = {
  intro: {
    rev: "9f45eed7",
    // 756 frames at 60 fps.
    duration: 756 / 60,
    comps: ["phone", "tablet-p", "tablet-l", "laptop", "desktop"],
    cuts: [
      { film: "intro", comp: "phone", theme: "dark", rung: "hevc60", src: "/brand/films/intro/9f45eed7/phone-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 960, height: 1920, fps: 60, bytes: 2942837, sha256: "3ed9ba6fd41cacede675e856a822dbfb07e3321adddfea03e224e7c459b3f653" },
      { film: "intro", comp: "phone", theme: "dark", rung: "avc30", src: "/brand/films/intro/9f45eed7/phone-dark-avc30.mp4", codecs: "avc1.640020", width: 720, height: 1440, fps: 30, bytes: 1503977, sha256: "4881dfc156983654536a95647a0cf1aec9f49a767f7c9c8775f742d64834a620" },
      { film: "intro", comp: "phone", theme: "light", rung: "hevc60", src: "/brand/films/intro/9f45eed7/phone-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 960, height: 1920, fps: 60, bytes: 3084026, sha256: "0db7a8d66a99ce2a01bf0143bc2c5d10db1e89ed37237852e97c40d478d489d3" },
      { film: "intro", comp: "phone", theme: "light", rung: "avc30", src: "/brand/films/intro/9f45eed7/phone-light-avc30.mp4", codecs: "avc1.640020", width: 720, height: 1440, fps: 30, bytes: 1516863, sha256: "878a3060ba555f0614a67194a97ae62cb58a218edadbc46397ebf1dddcd51086" },
      { film: "intro", comp: "tablet-p", theme: "dark", rung: "hevc60", src: "/brand/films/intro/9f45eed7/tablet-p-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1200, height: 1600, fps: 60, bytes: 2965123, sha256: "d49a55acb26b76e0266a2cd4e08a2fbd2f8edc02e5ebe8d18a463a2e6c937468" },
      { film: "intro", comp: "tablet-p", theme: "dark", rung: "avc30", src: "/brand/films/intro/9f45eed7/tablet-p-dark-avc30.mp4", codecs: "avc1.640028", width: 900, height: 1200, fps: 30, bytes: 1578772, sha256: "1cd246c9e9d082770adbe671d531a461c00029d6dac9137636638fa0983159ed" },
      { film: "intro", comp: "tablet-p", theme: "light", rung: "hevc60", src: "/brand/films/intro/9f45eed7/tablet-p-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1200, height: 1600, fps: 60, bytes: 3036444, sha256: "904a145a54c1ed789619ce8327c9ddf32a11aeffad25212b6a98f288382e96aa" },
      { film: "intro", comp: "tablet-p", theme: "light", rung: "avc30", src: "/brand/films/intro/9f45eed7/tablet-p-light-avc30.mp4", codecs: "avc1.640028", width: 900, height: 1200, fps: 30, bytes: 1422505, sha256: "0b9d8aec7a7bb2d59284fb4b25321e811e876647ff9366a132927923d613ae20" },
      { film: "intro", comp: "tablet-l", theme: "dark", rung: "hevc60", src: "/brand/films/intro/9f45eed7/tablet-l-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1600, height: 1200, fps: 60, bytes: 2982770, sha256: "59d1b49d78bb7617392f474030eb9af0588c5df1864e540da52d0c6afea1d96f" },
      { film: "intro", comp: "tablet-l", theme: "dark", rung: "avc30", src: "/brand/films/intro/9f45eed7/tablet-l-dark-avc30.mp4", codecs: "avc1.640028", width: 1200, height: 900, fps: 30, bytes: 1594171, sha256: "d8dc6377113bdd25e11395faf5fd4dfe8abbdabfadeb0c2d4ff8e5b6e40be20c" },
      { film: "intro", comp: "tablet-l", theme: "light", rung: "hevc60", src: "/brand/films/intro/9f45eed7/tablet-l-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1600, height: 1200, fps: 60, bytes: 3032469, sha256: "7d764ed93eb4edef440fd80047b12a9742e9df6e88de9e535b7a9d47e9a915f5" },
      { film: "intro", comp: "tablet-l", theme: "light", rung: "avc30", src: "/brand/films/intro/9f45eed7/tablet-l-light-avc30.mp4", codecs: "avc1.640028", width: 1200, height: 900, fps: 30, bytes: 1479435, sha256: "eca1918df50ea3a80cca0d0c498619c32b2c411974426919f09790f406ff4c9f" },
      { film: "intro", comp: "laptop", theme: "dark", rung: "hevc60", src: "/brand/films/intro/9f45eed7/laptop-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 1080, fps: 60, bytes: 2995517, sha256: "ec231a78a4a762be53e812b6de27bff01d6e644b5e991a6bacd391de67f1f757" },
      { film: "intro", comp: "laptop", theme: "dark", rung: "avc30", src: "/brand/films/intro/9f45eed7/laptop-dark-avc30.mp4", codecs: "avc1.640028", width: 1440, height: 810, fps: 30, bytes: 1451065, sha256: "fb90f9add40bc6c240ed2b950ad5a3458a51c44ad23868aa4918540901479cb3" },
      { film: "intro", comp: "laptop", theme: "light", rung: "hevc60", src: "/brand/films/intro/9f45eed7/laptop-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 1080, fps: 60, bytes: 3020056, sha256: "2911fc6d73866534311435d67c0e3cbb57f85494a1a4e40d3adf0b11acf3ea5e" },
      { film: "intro", comp: "laptop", theme: "light", rung: "avc30", src: "/brand/films/intro/9f45eed7/laptop-light-avc30.mp4", codecs: "avc1.640028", width: 1440, height: 810, fps: 30, bytes: 1493735, sha256: "fb72710ed3de405eda8595703c5db2292f7b4c8e0ae75757d717fec0d9313d19" },
      { film: "intro", comp: "desktop", theme: "dark", rung: "hevc60", src: "/brand/films/intro/9f45eed7/desktop-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 960, fps: 60, bytes: 3143781, sha256: "92664b626d053a7d91da9724dd2df00ba9cf78f08765beaaff8b4e062386afb9" },
      { film: "intro", comp: "desktop", theme: "dark", rung: "avc30", src: "/brand/films/intro/9f45eed7/desktop-dark-avc30.mp4", codecs: "avc1.640020", width: 1440, height: 720, fps: 30, bytes: 1445910, sha256: "89209e0fcbccbfd2cc3b3a63c163a3110b3c26c10ad62ad17bd2dc008489cc7d" },
      { film: "intro", comp: "desktop", theme: "light", rung: "hevc60", src: "/brand/films/intro/9f45eed7/desktop-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 960, fps: 60, bytes: 3179266, sha256: "953c51783e8c46be865a8f2687c3f40503b0ac4de92e23317634d84b485894d2" },
      { film: "intro", comp: "desktop", theme: "light", rung: "avc30", src: "/brand/films/intro/9f45eed7/desktop-light-avc30.mp4", codecs: "avc1.640020", width: 1440, height: 720, fps: 30, bytes: 1509729, sha256: "21acde5a1ffcddf772ed95fd62957285d0f0e4680100e07fcc6e72f3b24d7704" },
    ],
    posters: {
      "phone-dark": "/brand/films/intro/9f45eed7/phone-dark.webp",
      "phone-light": "/brand/films/intro/9f45eed7/phone-light.webp",
      "tablet-p-dark": "/brand/films/intro/9f45eed7/tablet-p-dark.webp",
      "tablet-p-light": "/brand/films/intro/9f45eed7/tablet-p-light.webp",
      "tablet-l-dark": "/brand/films/intro/9f45eed7/tablet-l-dark.webp",
      "tablet-l-light": "/brand/films/intro/9f45eed7/tablet-l-light.webp",
      "laptop-dark": "/brand/films/intro/9f45eed7/laptop-dark.webp",
      "laptop-light": "/brand/films/intro/9f45eed7/laptop-light.webp",
      "desktop-dark": "/brand/films/intro/9f45eed7/desktop-dark.webp",
      "desktop-light": "/brand/films/intro/9f45eed7/desktop-light.webp",
    },
    audio: { src: "/brand/films/intro/9f45eed7/sound.m4a", bytes: 204816, sha256: "939dbdf1ed5a7e3a9b519c32ee3ba924ea17d185dc6462de950deac4f33e9e48", lufs: -16.1, duration: 12.6 },
  },
  welcome: {
    rev: "97d9ab68",
    // 720 frames at 60 fps.
    duration: 720 / 60,
    comps: ["phone", "tablet-p", "tablet-l", "laptop", "desktop"],
    cuts: [
      { film: "welcome", comp: "phone", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/phone-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 960, height: 1920, fps: 60, bytes: 1150965, sha256: "dd807a040b0c5ee609f06cfd2b788ce8683f23c4f2ae344a68a1f2fa7769291a" },
      { film: "welcome", comp: "phone", theme: "dark", rung: "avc30", src: "/brand/films/welcome/97d9ab68/phone-dark-avc30.mp4", codecs: "avc1.640020", width: 720, height: 1440, fps: 30, bytes: 1288206, sha256: "9f48cb7d8fc716dfeefc24198d41bc44c6702cd16d50695ac34e55e054881a0f" },
      { film: "welcome", comp: "phone", theme: "light", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/phone-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 960, height: 1920, fps: 60, bytes: 1651978, sha256: "7f3dde4f41f677ad61a7aff0f1e2b0067b0e999a63fab94bb58a179a01aeaa9b" },
      { film: "welcome", comp: "phone", theme: "light", rung: "avc30", src: "/brand/films/welcome/97d9ab68/phone-light-avc30.mp4", codecs: "avc1.640020", width: 720, height: 1440, fps: 30, bytes: 1449969, sha256: "3e6e6b9a80026b5a76bf60804b46e6bec38a130fdf520a0a1b10e01b5fef7282" },
      { film: "welcome", comp: "tablet-p", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/tablet-p-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1200, height: 1600, fps: 60, bytes: 1166245, sha256: "8338096116644a8b212c10c704ac9d9781b21fc47fc99476e4505095b8a0869c" },
      { film: "welcome", comp: "tablet-p", theme: "dark", rung: "avc30", src: "/brand/films/welcome/97d9ab68/tablet-p-dark-avc30.mp4", codecs: "avc1.640028", width: 900, height: 1200, fps: 30, bytes: 1383314, sha256: "a6caee9052e8cb000e4f43a9930b12821ba669d7ab38868876c87799779c52f4" },
      { film: "welcome", comp: "tablet-p", theme: "light", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/tablet-p-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1200, height: 1600, fps: 60, bytes: 1709882, sha256: "4bc4a4474b090df854b08408a0c3a74ee1ed97ce8c687a1f6a4e8d5640724bfb" },
      { film: "welcome", comp: "tablet-p", theme: "light", rung: "avc30", src: "/brand/films/welcome/97d9ab68/tablet-p-light-avc30.mp4", codecs: "avc1.640028", width: 900, height: 1200, fps: 30, bytes: 1581033, sha256: "487ec89f79156c28ecdf0ad5362b7c9ff21d28005e05898e28a88f67e38e29cb" },
      { film: "welcome", comp: "tablet-l", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/tablet-l-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1600, height: 1200, fps: 60, bytes: 1199365, sha256: "3ff73611ec8240f5ff4291a8cf9204697ea5cf903210072808769a30bcc55cc6" },
      { film: "welcome", comp: "tablet-l", theme: "dark", rung: "avc30", src: "/brand/films/welcome/97d9ab68/tablet-l-dark-avc30.mp4", codecs: "avc1.640028", width: 1200, height: 900, fps: 30, bytes: 1398722, sha256: "e69076b6e6f8f076bdc80d1c9b4cd573183f038f136cfbd54852bda6b6efa384" },
      { film: "welcome", comp: "tablet-l", theme: "light", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/tablet-l-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1600, height: 1200, fps: 60, bytes: 1662421, sha256: "828a1351e2b990e9bfa8026a9452b826e56a91d40e9f6b556da597f09692cc7c" },
      { film: "welcome", comp: "tablet-l", theme: "light", rung: "avc30", src: "/brand/films/welcome/97d9ab68/tablet-l-light-avc30.mp4", codecs: "avc1.640028", width: 1200, height: 900, fps: 30, bytes: 1565000, sha256: "4ac51ceb98f0bff52bff3b0efe1a6baec695b49455e872c34ff23f2fb25eee35" },
      { film: "welcome", comp: "laptop", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/laptop-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 1080, fps: 60, bytes: 1225530, sha256: "faaec309473b8a52f28407e492ecfb8c6bbf306df813989b5110d6af18ec9c58" },
      { film: "welcome", comp: "laptop", theme: "dark", rung: "avc30", src: "/brand/films/welcome/97d9ab68/laptop-dark-avc30.mp4", codecs: "avc1.640028", width: 1440, height: 810, fps: 30, bytes: 1455299, sha256: "5c441a2cb04330445c43f56dab4b589d1dbb0c86b065fa8bfa2243ff88762031" },
      { film: "welcome", comp: "laptop", theme: "light", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/laptop-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 1080, fps: 60, bytes: 1657096, sha256: "3116035f9c4e10463597dd46246a3c51c92a80abb5c3d768a20b2fcb45c21b62" },
      { film: "welcome", comp: "laptop", theme: "light", rung: "avc30", src: "/brand/films/welcome/97d9ab68/laptop-light-avc30.mp4", codecs: "avc1.640028", width: 1440, height: 810, fps: 30, bytes: 1431047, sha256: "67f26b52597e3a3ee7cb140335fa51daab81911d268ddd4ddb225d3614b29ae1" },
      { film: "welcome", comp: "desktop", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/desktop-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 960, fps: 60, bytes: 1123020, sha256: "b5942eec1878653153af5f1e4bc5652c0f105f652b6f10c9d6097f2abed76b85" },
      { film: "welcome", comp: "desktop", theme: "dark", rung: "avc30", src: "/brand/films/welcome/97d9ab68/desktop-dark-avc30.mp4", codecs: "avc1.640020", width: 1440, height: 720, fps: 30, bytes: 1284686, sha256: "3fd2054ee975541180579034c533238ba3d17eded7f023c6567eac81ffadf6f7" },
      { film: "welcome", comp: "desktop", theme: "light", rung: "hevc60", src: "/brand/films/welcome/97d9ab68/desktop-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 960, fps: 60, bytes: 1531665, sha256: "5cbbf4c4ece2b649d45b9cd8e05dc02a492066210054bee87064bfe5133b84ad" },
      { film: "welcome", comp: "desktop", theme: "light", rung: "avc30", src: "/brand/films/welcome/97d9ab68/desktop-light-avc30.mp4", codecs: "avc1.640020", width: 1440, height: 720, fps: 30, bytes: 1598610, sha256: "9d2ec5ae6283efc3a405549b860647283406fe753020e6b41219df0d5f4e207c" },
    ],
    posters: {
      "phone-dark": "/brand/films/welcome/97d9ab68/phone-dark.webp",
      "phone-light": "/brand/films/welcome/97d9ab68/phone-light.webp",
      "tablet-p-dark": "/brand/films/welcome/97d9ab68/tablet-p-dark.webp",
      "tablet-p-light": "/brand/films/welcome/97d9ab68/tablet-p-light.webp",
      "tablet-l-dark": "/brand/films/welcome/97d9ab68/tablet-l-dark.webp",
      "tablet-l-light": "/brand/films/welcome/97d9ab68/tablet-l-light.webp",
      "laptop-dark": "/brand/films/welcome/97d9ab68/laptop-dark.webp",
      "laptop-light": "/brand/films/welcome/97d9ab68/laptop-light.webp",
      "desktop-dark": "/brand/films/welcome/97d9ab68/desktop-dark.webp",
      "desktop-light": "/brand/films/welcome/97d9ab68/desktop-light.webp",
    },
    audio: { src: "/brand/films/welcome/97d9ab68/sound.m4a", bytes: 190100, sha256: "10c72ee30c1c23af9ac304668c8185e07cc95b9956444656138a1b3995526a27", lufs: -16.1, duration: 12 },
  },
};

export const RETURN_STING: FilmAudio | null = { src: "/brand/films/return/caef4cdd/sting.m4a", bytes: 20151, sha256: "1518fd3ef06371dc77934e1d52ea1df149ab015c82f13f84b5027fdf7a434cf0", lufs: -20.1, duration: 1.2 };
