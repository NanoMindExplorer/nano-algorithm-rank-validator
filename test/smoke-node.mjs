/**
 * Node smoke test — loads lib scripts via vm with a fake window.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const lib = path.join(root, "src", "lib");

const sandbox = { console, performance: { now: () => Date.now() } };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

const files = [
  "snowflake.js",
  "weights.js",
  "profiles.js",
  "content-features.js",
  "phoenix-proxy.js",
  "filters.js",
  "weighted-scorer.js",
  "ranking-scorer.js",
  "affinity.js",
  "export.js",
  "sidecar.js",
  "pipeline.js",
];

for (const f of files) {
  const code = fs.readFileSync(path.join(lib, f), "utf8");
  vm.runInContext(code, sandbox, { filename: f });
}

const {
  NARVPipeline,
  NARVRanking,
  NARVSnowflake,
  NARVProfiles,
  NARVAffinity,
  NARVExport,
} = sandbox;

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    failed++;
  } else {
    console.log("OK  ", name);
  }
}

const id = "1880000000000000000";
assert("snowflake", typeof NARVSnowflake.tweetAgeHours(id) === "number");

const tweet = {
  tweetId: id,
  authorId: "dev",
  authorHandle: "dev",
  text: "How should creators use the open X algorithm?\n\nShare your workflow.",
  hasImage: true,
  hasMedia: true,
  authorVerified: true,
  authorFollowers: 50000,
  likeCount: 1200,
  replyCount: 340,
  repostCount: 180,
  viewCount: 90000,
  ageHours: 1.2,
};

const report = NARVPipeline.validateTweet(tweet, {
  inNetwork: true,
  profileId: "conversation",
});
assert("finalScore", report.finalScore > 0);
assert("grade", !!report.grade.letter);
assert("signals", report.weighted.rankedContributions.length >= 10);
assert("profile", report.profileId === "conversation");
assert("diversity", NARVRanking.diversityMultiplier(0.6, 0.25, 1) < 1);
assert("profiles listed", NARVProfiles.listProfiles().length >= 4);

const spam = NARVPipeline.validateDraft("FREE MONEY crypto giveaway click here now!!!", {});
assert(
  "spam weaker or flagged",
  spam.finalScore < report.finalScore || spam.insights.risks.length > 0
);

const history = JSON.parse(
  fs.readFileSync(path.join(root, "test", "sample-history.json"), "utf8")
);
const cal = NARVAffinity.calibrate(history);
assert("affinity calibrated", cal.sampleSize > 0 && cal.historyAffinity > 0);
assert("suggest profile", typeof NARVAffinity.suggestProfile(cal) === "string");

const csv = NARVExport.scanToCsv([
  { rank: 1, report, tweet, finalScore: report.finalScore, grade: report.grade },
]);
assert("csv export", csv.includes("final_score") && csv.includes("dev"));

console.log("\nScore sample:", report.finalScore.toFixed(4), report.grade.letter, report.profileId);
console.log("Affinity:", cal.historyAffinity.toFixed(3), "→", NARVAffinity.suggestProfile(cal));
console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
