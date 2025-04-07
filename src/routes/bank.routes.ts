import express, { Router } from 'express';
import { AccountController } from '../controllers/accounts.controller';
import { accountSchemas, validateQuery } from '../middleware/validation.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

const router: Router = express.Router();
const accountController = new AccountController();

router.use(authMiddleware);

router.get(
  '/',
  validateQuery(accountSchemas.getBanks),
  accountController.getBanks
);

export default router;