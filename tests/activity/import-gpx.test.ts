import { test } from "node:test";
import assert from "node:assert/strict";
import { readGpx, parseXmlTime, cleanDeviceName } from "@/lib/activity/import/gpx";
import { sportFromLabel, sportFromTcx } from "@/lib/activity/import/sport";
import { readTcx } from "@/lib/activity/import/tcx";
import { ImportError, sumIfAllKnown } from "@/lib/activity/import/types";
import { decodeEntities, scanXml, XmlError } from "@/lib/activity/import/xml";

const iso = (s: number) => new Date(Date.UTC(2026, 10, 12, 1, 32, 0) + s * 1000).toISOString();

function garminGpx(points = 5): string {
  const trkpts = Array.from({ length: points }, (_, i) => `
      <trkpt lat="${(12.97634 + i * 0.0001).toFixed(7)}" lon="77.5928700">
        <ele>${(920 + i).toFixed(1)}</ele>
        <time>${iso(i)}</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${130 + i}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>Not the track name</name><time>${iso(0)}</time></metadata>
  <trk>
    <name>Cubbon Park &amp; back <![CDATA[run]]></name>
    <type>running</type>
    <trkseg>${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

test("a Garmin GPX: creator, track name, sport, elevation, heart rate", () => {
  const parsed = readGpx(garminGpx());
  assert.equal(parsed.format, "gpx");
  assert.equal(parsed.device, "Garmin Connect");
  assert.equal(parsed.name, "Cubbon Park & back run");
  assert.deepEqual(parsed.sport, { kind: "known", sport: "run", label: "running" });
  assert.equal(parsed.segments.length, 1);
  const [first, second] = parsed.segments[0];
  assert.deepEqual([first.lat, first.lng, first.alt, first.heartRate, first.speed, first.acc], [12.97634, 77.59287, 920, 130, null, null]);
  assert.equal(second.t - first.t, 1000);
  assert.equal(parsed.startedAt, Date.parse(iso(0)));
  assert.equal(parsed.endedAt, Date.parse(iso(4)));
  assert.equal(parsed.segmentsArePauses, true);
  assert.equal(parsed.totals, null);
});

test("an Apple Health route file: lon before lat, speed and accuracy extensions, no sport", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Apple Health Export" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><time>${iso(0)}</time></metadata>
<trk><name>Route 2026-11-12 7:02am</name><trkseg>
<trkpt lon="77.592870" lat="12.976340"><ele>920.4</ele><time>${iso(0)}</time><extensions><speed>2.9</speed><course>40.1</course><hAcc>4.6</hAcc><vAcc>3.2</vAcc></extensions></trkpt>
<trkpt lon="77.592900" lat="12.976370"><ele>920.6</ele><time>${iso(1)}</time><extensions><speed>3.1</speed><course>40.1</course><hAcc>40.0</hAcc><vAcc>3.3</vAcc></extensions></trkpt>
</trkseg></trk></gpx>`;
  const parsed = readGpx(xml);
  assert.equal(parsed.device, "Apple Health Export");
  assert.deepEqual(parsed.sport, { kind: "unknown", label: null });
  const [a, b] = parsed.segments[0];
  assert.deepEqual([a.lat, a.lng, a.speed, a.acc, a.altAcc], [12.97634, 77.59287, 2.9, 4.6, 3.2]);
  assert.equal(b.acc, 40, "a poor fix keeps its real accuracy (the engine then leaves it out)");
});

test("track segments stay separate; points without a time or position are skipped", () => {
  const xml = `<gpx><trk><trkseg>
  <trkpt lat="12.1" lon="77.1"><time>${iso(0)}</time></trkpt>
  <trkpt lat="12.1001" lon="77.1"><time>${iso(1)}</time></trkpt>
  <trkpt lat="12.1002" lon="77.1"></trkpt>
  <trkpt lat="95" lon="77.1"><time>${iso(2)}</time></trkpt>
</trkseg><trkseg>
  <trkpt lat="12.2" lon="77.2"><time>${iso(60)}</time></trkpt>
  <trkpt lat="12.2001" lon="77.2"><time>${iso(61)}</time></trkpt>
</trkseg></trk></gpx>`;
  const parsed = readGpx(xml);
  assert.deepEqual(parsed.segments.map((segment) => segment.length), [2, 2]);
  assert.equal(parsed.skippedPoints, 2);
  assert.equal(parsed.endedAt - parsed.startedAt, 61_000);
});

test("routes without times, empty files and broken markup are refused with a reason", () => {
  const code = (xml: string) => {
    try {
      readGpx(xml);
      return "ok";
    } catch (error) {
      assert.ok(error instanceof ImportError);
      return error.code;
    }
  };
  assert.equal(code(`<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt><trkpt lat="1.1" lon="2"/></trkseg></trk></gpx>`), "no-times");
  assert.equal(code(`<gpx><rte><rtept lat="1" lon="2"/></rte><wpt lat="1" lon="2"/></gpx>`), "no-points");
  assert.equal(code(`<gpx><trk><trkseg><trkpt lat="1" lon="2"><time>${iso(0)}</time></trkpt><trkpt lat="1.1`), "damaged");
});

test("times without a zone are UTC; creator names are tidied, never invented", () => {
  assert.equal(parseXmlTime("2026-11-12T01:32:00"), Date.UTC(2026, 10, 12, 1, 32, 0));
  assert.equal(parseXmlTime("2026-11-12T07:02:00+05:30"), Date.UTC(2026, 10, 12, 1, 32, 0));
  assert.equal(parseXmlTime("yesterday"), null);
  assert.equal(cleanDeviceName("StravaGPX Android"), "Strava");
  assert.equal(cleanDeviceName("  Polar   Flow "), "Polar Flow");
  assert.equal(cleanDeviceName(""), null);
  assert.equal(cleanDeviceName("x".repeat(300))?.length, 120);
});

test("the XML scanner expands no entities of its own and stops at broken markup", () => {
  const texts: string[] = [];
  const xml = `<!DOCTYPE gpx [<!ENTITY boom "lol lol lol">]><a><b>&boom; &lt;ok&gt; &#65;&#x42;</b><!-- <b>hidden</b> --><b><![CDATA[<raw>]]></b></a>`;
  scanXml(xml, { text: (text) => texts.push(text) });
  assert.deepEqual(texts, ["&boom; <ok> AB", "<raw>"]);
  assert.equal(decodeEntities("&amp;amp;"), "&amp;");
  assert.throws(() => scanXml("<a><!-- never closed", {}), XmlError);
  assert.throws(() => scanXml(`<a b="never closed>`, {}), XmlError);
  let depth = "";
  for (let i = 0; i < 80; i++) depth += "<x>";
  assert.throws(() => scanXml(depth, {}, { maxDepth: 64 }), XmlError);
});

test("an unclosed point in a large file is linear work, not a regex blow-up", () => {
  const many = "<trkpt lat=\"1\" lon=\"2\">".repeat(20_000);
  const started = Date.now();
  assert.throws(() => readGpx(`<gpx><trk><trkseg>${many}</trkseg></trk></gpx>`));
  assert.ok(Date.now() - started < 2000, "parsing stayed fast");
});

const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
    <Activity Sport="Running">
      <Id>${iso(-2)}</Id>
      <Lap StartTime="${iso(-2)}">
        <TotalTimeSeconds>60.0</TotalTimeSeconds>
        <DistanceMeters>180.0</DistanceMeters>
        <Calories>12</Calories>
        <Track>
          <Trackpoint><Time>${iso(-2)}</Time><DistanceMeters>0</DistanceMeters></Trackpoint>
          <Trackpoint><Time>${iso(0)}</Time><Position><LatitudeDegrees>12.97634</LatitudeDegrees><LongitudeDegrees>77.59287</LongitudeDegrees></Position><AltitudeMeters>920.2</AltitudeMeters><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>131</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:Speed>3.05</ns3:Speed></ns3:TPX></Extensions></Trackpoint>
          <Trackpoint><Time>${iso(1)}</Time><Position><LatitudeDegrees>12.97637</LatitudeDegrees><LongitudeDegrees>77.59289</LongitudeDegrees></Position><AltitudeMeters>920.4</AltitudeMeters><DistanceMeters>3.1</DistanceMeters><HeartRateBpm><Value>132</Value></HeartRateBpm></Trackpoint>
        </Track>
      </Lap>
      <Lap StartTime="${iso(2)}">
        <TotalTimeSeconds>30.0</TotalTimeSeconds>
        <DistanceMeters>90.0</DistanceMeters>
        <Calories>6</Calories>
        <Track>
          <Trackpoint><Time>${iso(2)}</Time><Position><LatitudeDegrees>12.97640</LatitudeDegrees><LongitudeDegrees>77.59291</LongitudeDegrees></Position><DistanceMeters>6.2</DistanceMeters></Trackpoint>
        </Track>
      </Lap>
      <Creator xsi:type="Device_t"><Name>Forerunner 255</Name><UnitId>3412345678</UnitId><ProductID>3990</ProductID></Creator>
    </Activity>
  </Activities>
  <Author xsi:type="Application_t"><Name>Connect Api</Name></Author>
</TrainingCenterDatabase>`;

test("a TCX activity: creator device, sport, laps as one stream, device totals", () => {
  const parsed = readTcx(tcx);
  assert.equal(parsed.format, "tcx");
  assert.equal(parsed.device, "Forerunner 255");
  assert.deepEqual(parsed.sport, { kind: "known", sport: "run", label: "Running" });
  assert.equal(parsed.segmentsArePauses, false, "laps are not pauses");
  assert.deepEqual(parsed.segments.map((segment) => segment.length), [2, 1]);
  const [first, second] = parsed.segments[0];
  assert.deepEqual([first.alt, first.heartRate, first.speed, first.distanceM], [920.2, 131, 3.05, 0]);
  assert.equal(second.distanceM, 3.1);
  assert.equal(parsed.skippedPoints, 1, "the point without a position");
  assert.equal(parsed.startedAt, Date.parse(iso(-2)), "the device's own start, just before the first point");
  assert.deepEqual(parsed.totals, { distanceM: 270, timerSeconds: 90, elapsedSeconds: null, ascentM: null, kcal: 18 });
});

test("TCX lap totals count only values every lap has (a lap without calories leaves them unknown)", () => {
  const parsed = readTcx(tcx.replace("<Calories>6</Calories>", ""));
  assert.equal(parsed.totals?.kcal, null, "not 12 from the first lap alone");
  assert.equal(parsed.totals?.distanceM, 270);
  assert.equal(parsed.totals?.timerSeconds, 90);
});

test("sumIfAllKnown adds values only when none is unknown", () => {
  assert.equal(sumIfAllKnown([1, 2, 3]), 6);
  assert.equal(sumIfAllKnown([1, null, 3]), null);
  assert.equal(sumIfAllKnown([]), null);
  assert.equal(sumIfAllKnown([0, 0]), 0);
});

test("TCX sports and refusals", () => {
  assert.deepEqual(sportFromTcx("Biking"), { kind: "known", sport: "ride", label: "Cycling" });
  assert.deepEqual(sportFromTcx("Other"), { kind: "unknown", label: null });
  assert.throws(() => readTcx(`<TrainingCenterDatabase><Courses/></TrainingCenterDatabase>`), (error: unknown) => error instanceof ImportError && error.code === "not-activity");
  assert.throws(() => readTcx(`<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap><Track><Trackpoint><Time>${iso(0)}</Time></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>`), (error: unknown) => error instanceof ImportError && error.code === "no-points");
});

test("free-text sports: plain words map to walk, run or ride; other sports are refused; the rest is for the person to choose", () => {
  assert.deepEqual(sportFromLabel("Trail Running"), { kind: "known", sport: "run", label: "Trail Running" });
  assert.deepEqual(sportFromLabel("trail_running"), { kind: "known", sport: "run", label: "trail running" });
  assert.deepEqual(sportFromLabel("hiking"), { kind: "known", sport: "walk", label: "hiking" });
  assert.deepEqual(sportFromLabel("Road Cycling"), { kind: "known", sport: "ride", label: "Road Cycling" });
  assert.deepEqual(sportFromLabel("open_water_swimming"), { kind: "unsupported", label: "open water swimming" });
  assert.deepEqual(sportFromLabel("E-Bike Ride"), { kind: "unknown", label: "E Bike Ride" });
  assert.deepEqual(sportFromLabel("9"), { kind: "unknown", label: "9" });
  assert.deepEqual(sportFromLabel(""), { kind: "unknown", label: null });
});
