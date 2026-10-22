import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from './prisma.js';
import { sendPasswordResetEmail } from './email.js';

test('missing SMTP never writes password-reset links or recipient PII to stdout', async () => {
  const originalFind = prisma.systemConfig.findUnique;
  const originalLog = console.log;
  const env = { host: process.env.SMTP_HOST, node: process.env.NODE_ENV };
  const lines: unknown[][] = [];
  try {
    prisma.systemConfig.findUnique = (async () => null) as typeof originalFind;
    delete process.env.SMTP_HOST; process.env.NODE_ENV = 'development';
    console.log = (...args: unknown[]) => { lines.push(args); };
    await sendPasswordResetEmail('synthetic-private-marker@example.invalid', 'http://localhost/reset?token=synthetic-private-marker');
    assert.doesNotMatch(JSON.stringify(lines), /synthetic-private-marker/);
  } finally {
    prisma.systemConfig.findUnique = originalFind; console.log = originalLog;
    if (env.host === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = env.host;
    if (env.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env.node;
  }
});
