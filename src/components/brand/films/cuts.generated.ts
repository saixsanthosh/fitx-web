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
  { src: "/brand/films/welcome/1883aaf7/phone-dark.webp", bytes: 6336, sha256: "0665309870b9acbc50e14ab682a2804a0a405e660f990d846cf73f264b3ddc0e" },
  { src: "/brand/films/welcome/1883aaf7/phone-light.webp", bytes: 6532, sha256: "390493d0908765f0b944945ecedcd932f2828bf18546140cd67003661bcd7c19" },
  { src: "/brand/films/welcome/1883aaf7/tablet-p-dark.webp", bytes: 6532, sha256: "ec48437627c7811913572476eae09f9e476f58daf8be3492c5d301749092e9ba" },
  { src: "/brand/films/welcome/1883aaf7/tablet-p-light.webp", bytes: 6982, sha256: "ed9cd6eb1c28cb30f8d1f6fafc61c513c986f09a9ca75105420a9fe035b07878" },
  { src: "/brand/films/welcome/1883aaf7/tablet-l-dark.webp", bytes: 6262, sha256: "123dd9edec48c570a888f7333bf427a84ed4043d841ac928a8da20fc381834b7" },
  { src: "/brand/films/welcome/1883aaf7/tablet-l-light.webp", bytes: 7046, sha256: "d5f60bae38f8c8c1a55bee693766438d13dfbe639a7a11af51a88bccaa436475" },
  { src: "/brand/films/welcome/1883aaf7/laptop-dark.webp", bytes: 6714, sha256: "15975f5087e37f56577072c6592b5c6ef22269ff567d353bcbb29363beefc6fe" },
  { src: "/brand/films/welcome/1883aaf7/laptop-light.webp", bytes: 7442, sha256: "c1ddb8d520130b02fd40c15da9f625f152094f4871e87862c742eb92db200e9b" },
  { src: "/brand/films/welcome/1883aaf7/desktop-dark.webp", bytes: 6104, sha256: "6aedc69548161bc21f7dd07ca010e0e6ceecb3ffaf3f7efff7fd2fd78f8c9ae7" },
  { src: "/brand/films/welcome/1883aaf7/desktop-light.webp", bytes: 6870, sha256: "51d7b95ed4fddb57776f210c2411754ec5bc74b073ea9c2c878f19763f1ad455" },
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
    rev: "1883aaf7",
    // 720 frames at 60 fps.
    duration: 720 / 60,
    comps: ["phone", "tablet-p", "tablet-l", "laptop", "desktop"],
    cuts: [
      { film: "welcome", comp: "phone", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/phone-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 960, height: 1920, fps: 60, bytes: 1149318, sha256: "fd93507aded80c0871c80ea10772d679ea88c59ab74ee466f292a9c94a920280" },
      { film: "welcome", comp: "phone", theme: "dark", rung: "avc30", src: "/brand/films/welcome/1883aaf7/phone-dark-avc30.mp4", codecs: "avc1.640020", width: 720, height: 1440, fps: 30, bytes: 817199, sha256: "8e004fb63270e796c98c700ef3c6324e947bbbec87314222b136ad8a33f594d4" },
      { film: "welcome", comp: "phone", theme: "light", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/phone-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 960, height: 1920, fps: 60, bytes: 1652197, sha256: "241b86cd7fd04f75ca4aeea37ef1186903a7988de395ac9fc88e3cfc4073e98c" },
      { film: "welcome", comp: "phone", theme: "light", rung: "avc30", src: "/brand/films/welcome/1883aaf7/phone-light-avc30.mp4", codecs: "avc1.640020", width: 720, height: 1440, fps: 30, bytes: 1032823, sha256: "24f485a7627de05449c841c75b9e4322b4aa2f3eddfeeddfdde8df7661c53fa6" },
      { film: "welcome", comp: "tablet-p", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/tablet-p-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1200, height: 1600, fps: 60, bytes: 1165777, sha256: "9eacc51bed01f4a9d54c6d8495a782696a31ae3df60e387c269b3de0e5ff6467" },
      { film: "welcome", comp: "tablet-p", theme: "dark", rung: "avc30", src: "/brand/films/welcome/1883aaf7/tablet-p-dark-avc30.mp4", codecs: "avc1.640028", width: 900, height: 1200, fps: 30, bytes: 870807, sha256: "70a1e05eac4347d611e77d3ec3dae7169cbbeb1fccd1916eb5eeced57998fc3e" },
      { film: "welcome", comp: "tablet-p", theme: "light", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/tablet-p-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1200, height: 1600, fps: 60, bytes: 1709799, sha256: "3d157fad7a09e4445793e3a2f8d3d2dad9cb2279680a6cc5df90021d22127a05" },
      { film: "welcome", comp: "tablet-p", theme: "light", rung: "avc30", src: "/brand/films/welcome/1883aaf7/tablet-p-light-avc30.mp4", codecs: "avc1.640028", width: 900, height: 1200, fps: 30, bytes: 1123051, sha256: "b14661e58e1a36476926e27d7ac691cfa2813db94817670a358b967b13cc95d5" },
      { film: "welcome", comp: "tablet-l", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/tablet-l-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1600, height: 1200, fps: 60, bytes: 1200106, sha256: "36fab922d76fb5c70ce1c83d40dee9ddf6fb7702f29010327305ae75ee3cb465" },
      { film: "welcome", comp: "tablet-l", theme: "dark", rung: "avc30", src: "/brand/films/welcome/1883aaf7/tablet-l-dark-avc30.mp4", codecs: "avc1.640028", width: 1200, height: 900, fps: 30, bytes: 886837, sha256: "b16579b3ae58fc3348a95e0a95fe0a2868adf6951171b39d1f6bf974d4101520" },
      { film: "welcome", comp: "tablet-l", theme: "light", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/tablet-l-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1600, height: 1200, fps: 60, bytes: 1663100, sha256: "b7bc5a87af994f7de50230365ac3f3cb0476ff7f7a16fdece8c37bc9a3a543d5" },
      { film: "welcome", comp: "tablet-l", theme: "light", rung: "avc30", src: "/brand/films/welcome/1883aaf7/tablet-l-light-avc30.mp4", codecs: "avc1.640028", width: 1200, height: 900, fps: 30, bytes: 1116324, sha256: "9a5d61eaec53a37ce2cf8102233f35501062290d856165d4d84bd7e7927c3d0d" },
      { film: "welcome", comp: "laptop", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/laptop-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 1080, fps: 60, bytes: 1224501, sha256: "16466b9cbde59851481e5870f7018c2d4dbe8ad65038f47feb1eaa6389a16b04" },
      { film: "welcome", comp: "laptop", theme: "dark", rung: "avc30", src: "/brand/films/welcome/1883aaf7/laptop-dark-avc30.mp4", codecs: "avc1.640028", width: 1440, height: 810, fps: 30, bytes: 940886, sha256: "5bfa2a1fdfbedbd8aba3feb1d55d93cff816ee3b269ed7c1518c65cb562529ff" },
      { film: "welcome", comp: "laptop", theme: "light", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/laptop-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 1080, fps: 60, bytes: 1656791, sha256: "c247e924abbb603ddaacbf81c242fc5e8308e30b9ed8f5acdd1148f466a886b5" },
      { film: "welcome", comp: "laptop", theme: "light", rung: "avc30", src: "/brand/films/welcome/1883aaf7/laptop-light-avc30.mp4", codecs: "avc1.640028", width: 1440, height: 810, fps: 30, bytes: 1152009, sha256: "2f6bfaafe17c72c1144f8c5225c40ef4278d5b83026c2ee9eaac08e6ae7f2f25" },
      { film: "welcome", comp: "desktop", theme: "dark", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/desktop-dark-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 960, fps: 60, bytes: 1122420, sha256: "c1cb561da51ea976da885f5eec819d07a2663fbb1f726b65073d3d96bc753857" },
      { film: "welcome", comp: "desktop", theme: "dark", rung: "avc30", src: "/brand/films/welcome/1883aaf7/desktop-dark-avc30.mp4", codecs: "avc1.640020", width: 1440, height: 720, fps: 30, bytes: 834847, sha256: "581545f50e2b0c4329cf24a231891afa9c0a30a6d84a09c85b3abd6aa3cdbb7d" },
      { film: "welcome", comp: "desktop", theme: "light", rung: "hevc60", src: "/brand/films/welcome/1883aaf7/desktop-light-hevc60.mp4", codecs: "hvc1.1.6.H123.90", width: 1920, height: 960, fps: 60, bytes: 1530531, sha256: "6a584be71d10ff346646661ec6c270e12afd235790a2679866575882e76a4731" },
      { film: "welcome", comp: "desktop", theme: "light", rung: "avc30", src: "/brand/films/welcome/1883aaf7/desktop-light-avc30.mp4", codecs: "avc1.640020", width: 1440, height: 720, fps: 30, bytes: 1027712, sha256: "0fb68f72d080d444a300d6985e36c49a53625375042b358af5eb133e30ccfd08" },
    ],
    posters: {
      "phone-dark": "/brand/films/welcome/1883aaf7/phone-dark.webp",
      "phone-light": "/brand/films/welcome/1883aaf7/phone-light.webp",
      "tablet-p-dark": "/brand/films/welcome/1883aaf7/tablet-p-dark.webp",
      "tablet-p-light": "/brand/films/welcome/1883aaf7/tablet-p-light.webp",
      "tablet-l-dark": "/brand/films/welcome/1883aaf7/tablet-l-dark.webp",
      "tablet-l-light": "/brand/films/welcome/1883aaf7/tablet-l-light.webp",
      "laptop-dark": "/brand/films/welcome/1883aaf7/laptop-dark.webp",
      "laptop-light": "/brand/films/welcome/1883aaf7/laptop-light.webp",
      "desktop-dark": "/brand/films/welcome/1883aaf7/desktop-dark.webp",
      "desktop-light": "/brand/films/welcome/1883aaf7/desktop-light.webp",
    },
    audio: { src: "/brand/films/welcome/1883aaf7/sound.m4a", bytes: 190100, sha256: "10c72ee30c1c23af9ac304668c8185e07cc95b9956444656138a1b3995526a27", lufs: -16.1, duration: 12 },
  },
};

export const RETURN_STING: FilmAudio | null = { src: "/brand/films/return/caef4cdd/sting.m4a", bytes: 20151, sha256: "1518fd3ef06371dc77934e1d52ea1df149ab015c82f13f84b5027fdf7a434cf0", lufs: -20.1, duration: 1.2 };
