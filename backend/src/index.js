import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { router } from './routes/api.js';
import { initScheduler } from './scheduler.js';
import { initStore } from './store.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
}));
app.use(express.json());
app.use('/api', router);

initStore();
initScheduler();

app.listen(PORT, () => {
  console.log(`🌱 Farming Ads Worker rodando na porta ${PORT}`);
});
