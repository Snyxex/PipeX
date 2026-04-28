import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DataEngine , CompressionPlugin} from '../src/index.js';


async function runTest() {
  const engine = new DataEngine();
  
  
  
  engine.use(new CompressionPlugin({ type: 'brotli', level: 5 }));

  const originalFile = path.resolve('test/original.txt');
  const compressedFile = path.resolve('test/compressed.pipex');
  const restoredFile = path.resolve('test/restored.txt');

 
  const dummyContent = "PipeX ist super schnell! ".repeat(5000);
  writeFileSync(originalFile, dummyContent);
  console.log("📝 Originaldatei erstellt.");

  try {
    
    console.log("🗜️  Komprimiere Datei...");
    await engine.processFile(originalFile, compressedFile);

  
    console.log("🔓 Dekomprimiere Datei...");
    await engine.reverseFile(compressedFile, restoredFile);

   
    const original = readFileSync(originalFile, 'utf-8');
    const restored = readFileSync(restoredFile, 'utf-8');

    if (original === restored) {
      console.log("✅ ERFOLG: Die Dateien sind identisch!");
      
      const oldSize = readFileSync(originalFile).length;
      const newSize = readFileSync(compressedFile).length;
      console.log(`📊 Statistik: ${oldSize} Bytes -> ${newSize} Bytes (${Math.round((newSize/oldSize)*100)}%)`);
    } else {
      console.error("❌ FEHLER: Die Dateien unterscheiden sich!");
    }

  } catch (err) {
    console.error("💥 Test fehlgeschlagen:", err);
  }
}

runTest();