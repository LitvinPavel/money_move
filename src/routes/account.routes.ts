import express, { Router } from 'express';
import { AccountController } from '../controllers/accounts.controller';
import { accountSchemas, validate, validateQuery } from '../middleware/validation.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

const router: Router = express.Router();
const accountController = new AccountController();

router.use(authMiddleware);

router.post(
  '/',
  validate(accountSchemas.createAccount),
  accountController.createAccount
);

router.put(
  '/:accountId',
  accountController.updateAccount
);

router.get(
  '/',
  validateQuery(accountSchemas.getAccounts),
  accountController.getAccounts
);

router.get(
  '/balance',
  validateQuery(accountSchemas.getTotalBalance),
  accountController.getTotalBalance
);

router.delete(
  '/:accountId',
  accountController.deleteAccount
);

export default router;