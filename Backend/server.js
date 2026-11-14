import 'dotenv/config';
import { createApp } from './app.js';
import { initDatabase } from './db.js';

async function startServer() {
  const app = createApp();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await initDatabase();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Backend API running on http://localhost:${port}`));
}

startServer().catch(error => {
  const details = error.errors?.map(item => `${item.code} ${item.address}:${item.port}`).join(', ');
  console.error('Backend startup failed:', details || error.message || error);
  process.exit(1);
});
