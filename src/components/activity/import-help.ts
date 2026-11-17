/*
 * How to get an activity file out of the common watch and fitness apps, as plain text (no logos:
 * brand names are only named). FITX has no link to these services: the person exports a file and
 * picks it here. Steps follow each service's own menus; where a menu differs by app version the
 * text stays general rather than guessing a label.
 */

export type ExportHelp = { id: string; name: string; steps: string[]; note?: string };

export const EXPORT_HELP: readonly ExportHelp[] = [
  {
    id: "garmin",
    name: "Garmin Connect",
    steps: [
      "On a computer, sign in at connect.garmin.com and open the activity.",
      "Open the gear menu at the top right of the activity.",
      "Choose Export Original (a .zip: unpack it and pick the .fit file inside), Export to TCX or Export to GPX.",
    ],
    note: "Exporting works on the Garmin Connect website.",
  },
  {
    id: "strava",
    name: "Strava",
    steps: [
      "On strava.com, open your activity.",
      "Open the ⋯ menu beside it and choose Export Original (the file your device recorded) or Export GPX.",
      "For all your activities at once: Settings → My Account → Download or Delete Your Account → Request Your Archive. The archive’s activities folder holds the files; .gz files can be picked as they are.",
    ],
  },
  {
    id: "coros",
    name: "COROS",
    steps: [
      "In the COROS app, open the activity and use its share or export option to save a FIT, TCX or GPX file.",
      "Or open the activity on training.coros.com and export it there.",
    ],
  },
  {
    id: "apple",
    name: "Apple Health (Apple Watch)",
    steps: [
      "On your iPhone, open the Health app, tap your picture at the top right, then Export All Health Data.",
      "Save export.zip to Files, then tap it in Files to unpack it.",
      "Open apple_health_export, then workout-routes, and pick the route .gpx files you want.",
    ],
    note: "Route files don’t say the sport, so you choose walk, run or ride for each. Apple Health can’t be connected to a website, so files are the way in.",
  },
  {
    id: "other",
    name: "Other watches and apps",
    steps: [
      "Most apps (Polar Flow, Suunto, Wahoo, Amazfit and others) can export one activity as a GPX, TCX or FIT file, usually from the activity’s share or export menu or on their website.",
    ],
  },
];
