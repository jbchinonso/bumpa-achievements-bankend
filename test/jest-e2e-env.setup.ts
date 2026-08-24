// Runs before the test framework loads the app, so PrismaService connects
// to the dedicated test database instead of the dev one.
import { config } from 'dotenv';

config();

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
