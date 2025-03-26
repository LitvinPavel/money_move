import express, { Router } from 'express';
import { AccountController } from '../controllers/accounts.controller';
import { accountSchemas, validate } from '../middleware/validation.middleware';
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
  accountController.getAccounts
);

router.delete(
  '/:accountId',
  accountController.deleteAccount
);

export default router;