import { DataEngine,
    CompressionPlugin,
    EncryptionPlugin,
    HashingPlugin
 } from '../src/index.ts';
import { Readable, Writable } from 'node:stream';
import { Buffer } from 'node:buffer';

async function runTests() {
    const engine = new DataEngine();
    const MASTER_KEY = Buffer.alloc(32, 'paas-secret-key-1234567890123456'); // 32 Bytes
    const PEPPER = 'super-secure-pepper';

    // Pipeline konfigurieren
    engine
        .use(new CompressionPlugin({ type: 'brotli' }))
        .use(new EncryptionPlugin({ type: 'aes-256-gcm', key: MASTER_KEY }))
        .use(new HashingPlugin({ algorithm: 'sha512', secret: PEPPER }));

    console.log("🚀 Starte Compiler Integration Tests...\n");

    // --- TEST 1: BUFFER MODE (Kleine Texte) ---
    console.log("--- Test 1: Buffer Mode (String Transformation) ---");
    const rawData = "DB_PASSWORD=super-secret-123\nAPI_KEY=live_4455667788";
    
    try {
        const compiled = await engine.run(rawData);
        console.log("✅ Compilation erfolgreich");
        console.log("Original Größe:", Buffer.byteLength(rawData), "Bytes");
        console.log("Compiled Größe:", compiled.data.length, "Bytes");
        console.log("Hash (Fingerprint):", compiled.hash);

        const restored = await engine.undo(compiled.data);
        console.log("✅ Undo erfolgreich");
        console.log("Resultat stimmt überein:", restored.toString() === rawData ? "JA ✨" : "NEIN ❌");
    } catch (e) {
        console.error("❌ Test 1 Fehlgeschlagen:", e);
    }

    console.log("\n--------------------------------------------------\n");

    // --- TEST 2: STREAM MODE (Große Datenmengen) ---
    console.log("--- Test 2: Stream Mode (Große Datenmengen) ---");
    
    // Wir erstellen einen Mock-Stream, der 5MB Daten generiert
    const dummyLargeData = Buffer.alloc(15 * 1024 * 1024, 'A'); 
    const inputStream = Readable.from(dummyLargeData);
    
    let outputBuffer = Buffer.alloc(0);
    const outputStream = new Writable({
        write(chunk:any, encoding:any, callback:any) {
            outputBuffer = Buffer.concat([outputBuffer, chunk]);
            callback();
        }
    });

    try {
        const start = Date.now();
        await engine.stream(inputStream, outputStream);
        const duration = Date.now() - start;

        console.log("✅ Streaming erfolgreich beendet");
        console.log("Verarbeitete Menge:", (dummyLargeData.length / 1024 / 1024).toFixed(2), "MB");
        console.log("Zeitaufwand:", duration, "ms");
        console.log("Output Größe:", (outputBuffer.length / 1024 / 1024).toFixed(2), "MB");
    } catch (e) {
        console.error("❌ Test 2 Fehlgeschlagen:", e);
    }
}

runTests();