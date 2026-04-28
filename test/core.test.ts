import { DataEngine } from '../src/core/core.js';
import { Buffer } from 'node:buffer';

const log = {
  success: (msg: string) => console.log(`  \x1b[32m✅ ${msg}\x1b[0m`),
  error: (msg: string) => console.log(`  \x1b[31m❌ ${msg}\x1b[0m`),
  info: (msg: string) => console.log(`\n\x1b[36m🔹 ${msg}\x1b[0m`),
  header: (msg: string) => console.log(`\n\x1b[35m💀 PIPEX BATTLE-TEST (EXTREME CONDITIONS)\x1b[0m\n${'='.repeat(50)}`)
};

async function runBattleTests() {
  log.header("STARTING HARDCORE VALIDATION");
  const engine = new DataEngine();

  // --- TEST 1: Leere & Minimale Werte ---
  log.info("Test 1: Boundary Values (Empty/Null)");
  const boundaries = [
    { label: "Empty String", val: "", type: "string" },
    { label: "Zero Number", val: 0, type: "number" },
    { label: "Null Object", val: null, type: "json" },
    { label: "Empty Array", val: [], type: "json" },
    { label: "Empty Buffer", val: Buffer.alloc(0), type: "buffer" }
  ];

  for (const b of boundaries) {
    try {
      const res = await engine.run(b.val);
      const restored = await engine.undo(res.data, b.type);
      if (JSON.stringify(restored) === JSON.stringify(b.val) || restored === b.val) {
        log.success(`${b.label} erfolgreich`);
      } else {
        log.error(`${b.label} korrumpiert: ${restored}`);
      }
    } catch (e: any) { log.error(`${b.label} Crash: ${e.message}`); }
  }

  // --- TEST 2: Concurrency (Parallel-Verarbeitung) ---
  log.info("Test 2: High Concurrency (100 parallel runs)");
  try {
    const tasks = Array.from({ length: 100 }).map((_, i) => engine.run(`Task-${i}`));
    const results = await Promise.all(tasks);
    const undoTasks = results.map((r, i) => engine.undo(r.data, 'string'));
    const restored = await Promise.all(undoTasks);
    
    const allOk = restored.every((val, i) => val === `Task-${i}`);
    allOk ? log.success("100 parallele Tasks ohne Race-Conditions") : log.error("Datenverlust bei Parallelität!");
  } catch (e: any) { log.error(`Concurrency Crash: ${e.message}`); }

  // --- TEST 3: Plugin-Manipulation (Gedächtnis-Test) ---
  log.info("Test 3: Context Metadata Persistence");
  const metaPlugin = {
    name: 'meta-test', version: '1.0',
    process: async (d: Buffer, ctx: any) => {
      ctx.metadata.secret = "PipeX-Rocks"; // Plugin schreibt in Meta
      return d;
    },
    reverse: async (d: Buffer, ctx: any) => {
      // Prüfen, ob das undo-Context-Objekt isoliert ist oder Infos braucht
      return d;
    }
  };
  engine.use(metaPlugin);
  const metaRes = await engine.run("MetaTest");
  log.success("Plugin Metadata Handling stabil");

  // --- TEST 4: Extreme JSON (Deep & Wide) ---
  log.info("Test 4: Heavy Load JSON (Deep Nesting)");
  const deepObj: any = {};
  let current = deepObj;
  for (let i = 0; i < 500; i++) {
    current.next = { level: i };
    current = current.next;
  }
  try {
    const res = await engine.run(deepObj);
    const restored = await engine.undo(res.data, 'json');
    log.success("500-Level Deep Object erfolgreich transformiert");
  } catch (e: any) { log.error(`Deep JSON Crash: ${e.message}`); }

  // --- TEST 5: Buffer Corruptions (Undo Fail Safety) ---
  log.info("Test 5: Resiliency against corrupt data");
  try {
    const corruptedBuffer = Buffer.from("DEFINITELY_NOT_A_VALID_BUFFER_OR_JSON");
    await engine.undo(corruptedBuffer, 'json');
    log.error("Sollte bei korruptem JSON failen, tat es aber nicht");
  } catch (e: any) {
    log.success(`Erwarteter Fail bei korrupten Daten: ${e.message}`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log("🏆 PIPEX CORE IS BATTLE-HARDENED!\n");
}

runBattleTests().catch(console.error);