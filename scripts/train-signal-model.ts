/**
 * Trains the signal model from your own track record and prints how well it does on calls it never saw.
 * Run: npx tsx scripts/train-signal-model.ts          (print only)
 *      npx tsx scripts/train-signal-model.ts --save   (also store it in MongoDB for the app to use)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { patternStats, trainModel, type TrainRow } from "../lib/signalModel";

const TARGET = Number((process.argv.find((a) => a.startsWith("--target=")) ?? "--target=2").split("=")[1]) || 2;

async function main() {
  console.log(`target: reach ${TARGET}x from the call price`);
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "wraith");
  const now = Date.now();
  const docs = await db
    .collection("signal_calls")
    .find({ engine: 2, spottedMcap: { $gt: 0 }, spottedAt: { $lt: now - 4 * 3_600_000 } }, { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } })
    .limit(20000)
    .toArray();
  const rows: TrainRow[] = docs.map((d) => ({
    features: d.features ?? {},
    win: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= TARGET,
    at: d.spottedAt,
  }));
  const model = trainModel(rows);
  if (!model) { console.log("not enough calls yet:", rows.length); await client.close(); return; }
  const { holdout: h } = model;
  console.log(`calls ${model.n}  wins ${model.wins}  base ${(model.base * 100).toFixed(1)}%`);
  console.log(`held-out (newest ${h.n} calls): AUC ${h.auc}  top-quarter 2x rate ${(h.topQuartileRate * 100).toFixed(1)}%  bottom-quarter ${(h.bottomQuartileRate * 100).toFixed(1)}%  base ${(h.baseRate * 100).toFixed(1)}%`);
  console.log(`model ${model.active ? "ACTIVE (beats chance on unseen calls)" : "INACTIVE (not better than chance yet, scores are left alone)"}`);
  console.log("strongest effects:", model.top.map((t) => `${t.name} ${t.w > 0 ? "+" : ""}${t.w}`).join(", "));
  console.log("\npattern                       calls   2x rate   lift");
  for (const p of patternStats(rows)) console.log(`${p.label.padEnd(28)} ${String(p.calls).padStart(6)}   ${p.rate === null ? "  n/a " : (p.rate * 100).toFixed(1).padStart(5) + "%"}   ${p.lift ?? "-"}`);
  if (process.argv.includes("--save")) {
    await db.collection("signal_model").updateOne({ _id: "current" as never }, { $set: { model, patterns: patternStats(rows), at: new Date() } }, { upsert: true });
    console.log("\nsaved to signal_model/current");
  }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
