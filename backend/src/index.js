import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { router } from './routes/api.js';
import { initScheduler } from './scheduler.js';
import { initStore } from './store.js';
import { closeAllProxies } from './socksProxy.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
}));
app.use(express.json());
app.use('/api', router);

initStore();
initScheduler();

const server = app.listen(PORT, () => {
  console.log(`🌱 Farming Ads Worker rodando na porta ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[shutdown] Encerrando servidor...');
  await closeAllProxies();
  server.close(() => {
    console.log('[shutdown] Servidor encerrado');
    process.exit(0);
  });
});
