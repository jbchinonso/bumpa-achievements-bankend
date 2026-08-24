// Run once before the e2e suite: migrates and seeds the dedicated test
// database (DATABASE_URL_TEST), so e2e tests never touch dev data.
import { config } from 'dotenv';
import { execSync } from 'child_process';

config();

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) {
  throw new Error('DATABASE_URL_TEST is not set in .env');
}

const env = { ...process.env, DATABASE_URL: testDatabaseUrl };

execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
execSync('npx prisma db seed', { stdio: 'inherit', env });
