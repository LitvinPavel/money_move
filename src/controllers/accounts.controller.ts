import { Request, Response } from "express";
import { AccountService } from "../services/account.service";
import { ICreateAccount, IUpdateAccount } from "../interfaces/account.interface";

export class AccountController {
  private accountService: AccountService;

  constructor() {
    this.accountService = new AccountService();
  }

  public getBanks = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');

      const { search, page = '1', pageSize = '20' } = req.query;

      const result = await this.accountService.getRussianBanksPaginated(
        search?.toString(),
        parseInt(page.toString(), 10),
        parseInt(pageSize.toString(), 10)
      );
      
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: (error as { message: string; }).message });
    }
  };

  public createAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');

      const account = await this.accountService.createAccount(
        userId,
        req.body as ICreateAccount
      );
      res.status(201).json(account);
    } catch (error) {
      res.status(400).json({ error: (error as { message: string; }).message });
    }
  };

  public updateAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');

      const { accountId } = req.params;

      const account = await this.accountService.updateAccount(
        userId,
        parseInt(accountId),
        req.body as IUpdateAccount
      );
      res.status(201).json(account);
    } catch (error) {
      res.status(400).json({ error: (error as { message: string; }).message });
    }
  };

  public getAccounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const { type, bank_bic } = req.query as { type?: string; bank_bic?: string; };
      const accounts = await this.accountService.getAccounts(userId, { type, bank_bic });
      res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: (error as { message: string; }).message });
      }
  };

  public getTotalBalance = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const { groupBy } = req.query as { groupBy: 'type' | 'bank_bic'; };
      if (groupBy && !['type', 'bank_bic'].includes(groupBy)) {
        throw new Error('Invalid groupBy parameter. Allowed values: "type", "bank_bic"');
      }
      const accounts = await this.accountService.getTotalBalance(userId, groupBy);
      res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: (error as { message: string; }).message });
      }
  };

  public deleteAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');

      const { accountId } = req.params;
      const success = await this.accountService.deleteAccount(
        userId,
        parseInt(accountId)
      );

      if (success) {
        res.json({ message: "Account deleted successfully" });
      } else {
        res.status(400).json({ error: "Failed to delete account" });
      }
    } catch (error) {
        res.status(400).json({ error: (error as { message: string; }).message });
      }
  };
}
