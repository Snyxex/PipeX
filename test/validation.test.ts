import { z } from 'zod';
import { DataEngine } from '../src/index.js';
import assert from 'node:assert';

async function testValidationPlugin() {
  console.log('--- Testing Validation Plugin ---');

  const UserSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
  });

  const engine = new DataEngine()
    .setSchema(UserSchema);

  // 1. Valid data
  console.log('Testing valid data (Core)...');
  const validUser = { id: 1, name: 'Alice', email: 'alice@example.com' };
  const result = await engine.binary.run(validUser);
  assert.ok(result.data.length > 0);
  console.log('✓ Valid data accepted');

  // 2. Invalid data (missing field)
  console.log('Testing invalid data (missing field)...');
  const invalidUser1 = { id: 2, name: 'Bob' }; // email missing
  try {
    await engine.binary.run(invalidUser1);
    assert.fail('Should have thrown an error for missing field');
  } catch (e: any) {
    assert.ok(e.message.includes('Validation failed'));
    console.log('✓ Invalid data (missing field) rejected');
  }

  // 3. Invalid data (wrong type)
  console.log('Testing invalid data (wrong type)...');
  const invalidUser2 = { id: '3', name: 'Charlie', email: 'charlie@example.com' }; // id is string
  try {
    await engine.binary.run(invalidUser2);
    assert.fail('Should have thrown an error for wrong type');
  } catch (e: any) {
    assert.ok(e.message.includes('Validation failed'));
    console.log('✓ Invalid data (wrong type) rejected');
  }

  // 4. Invalid data (invalid email)
  console.log('Testing invalid data (invalid email)...');
  const invalidUser3 = { id: 4, name: 'Dave', email: 'not-an-email' };
  try {
    await engine.binary.run(invalidUser3);
    assert.fail('Should have thrown an error for invalid email');
  } catch (e: any) {
    assert.ok(e.message.includes('Validation failed'));
    console.log('✓ Invalid data (invalid email) rejected');
  }

  console.log('--- Validation Plugin Tests Passed ---');
}

testValidationPlugin().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
