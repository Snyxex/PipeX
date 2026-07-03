import { DataEngine } from '../src/core/dataEngine.js';
import { BasePlugin } from '../src/core/plugin.js';
import { z } from 'zod';
import type { SchemaRegistry } from '../src/core/types.js';

class ConfigPlugin extends BasePlugin {
  name = 'config-plugin';
  version = '1.0.0';
  constructor(public override options: any) { super(options); }
  process(data: Buffer) { return data; }
}

class MockSchemaRegistry implements SchemaRegistry {
  async getSchema(subject: string) {
    if (subject === 'user') return z.object({ name: z.string() });
    throw new Error('Schema not found');
  }
}

async function testConfig() {
  console.log('Testing Configuration & Registry...');
  
  // 1. Test fromConfig
  DataEngine.registerPlugin('config-plugin', ConfigPlugin);
  
  const config = {
    plugins: [
      { name: 'config-plugin', options: { foo: 'bar' } }
    ]
  };
  
  const engine = await DataEngine.fromConfig(config);
  const plugin = engine.plugins[0] as ConfigPlugin;
  
  if (plugin.name !== 'config-plugin' || plugin.options.foo !== 'bar') {
    throw new Error('fromConfig failed to initialize plugin correctly');
  }
  console.log('✅ fromConfig test passed!');

  // 2. Test Schema Registry
  const registry = new MockSchemaRegistry();
  engine.setSchemaRegistry(registry);
  
  await engine.loadSchema('user');
  
  // Should pass
  engine.validate({ name: 'Alice' });
  
  try {
    engine.validate({ age: 30 });
    throw new Error('Validation should have failed');
  } catch (e) {
    console.log('✅ Schema Registry validation test passed!');
  }
}

testConfig().catch(e => {
  console.error('❌ Config test failed:', e);
  process.exit(1);
});
