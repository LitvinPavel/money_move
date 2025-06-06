import './types/express';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import accountRoutes from './routes/account.routes';
import bankRoutes from './routes/bank.routes';
import transactionRoutes from './routes/transaction.routes';
import salaryRoutes from './routes/salary.routes';
import { errorHandler, notFound } from './middleware/error.middleware';

dotenv.config();

const app = express();

const corsOptions = {
  origin: [process.env.CLIENT_URL as string, 'http://localhost:5173'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/banks', bankRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/salary', salaryRoutes);

app.use(notFound);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});