import express from "express";
import { TransactionController } from "../controllers/transactions.controller";
import {
  transactionSchemas,
  validate,
  validateQuery,
} from "../middleware/validation.middleware";
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();
const transactionController = new TransactionController();

router.use(authMiddleware);

router.post(
  "/deposit",
  validate(transactionSchemas.deposit),
  transactionController.deposit
);

router.post(
  "/withdrawal",
  validate(transactionSchemas.withdrawal),
  transactionController.withdrawal
);

router.post(
  "/transfer",
  validate(transactionSchemas.transfer),
  transactionController.transfer
);

router.put(
  '/:id',
  validate(transactionSchemas.updateTransaction),
  transactionController.updateTransaction
);

router.get(
  "/balance",
  validateQuery(transactionSchemas.getBalanceSummary),
  transactionController.getBalanceSummary
);

router.get(
  "/history",
  validateQuery(transactionSchemas.history),
  transactionController.getHistory
);

router.delete(
  "/:transactionId",
  transactionController.deleteTransaction
);

export default router;
