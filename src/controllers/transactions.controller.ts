import { Request, Response, NextFunction } from "express";
import { TransactionService } from "../services/transaction.service";
import { AccountService } from "../services/account.service";
import {
  IDeposit,
  IWithdrawal,
  ITransfer,
  ITransactionPagination,
} from "../interfaces/transaction.interface";

export class TransactionController {
  private transactionService: TransactionService;
  private accountService: AccountService;

  constructor() {
    this.transactionService = new TransactionService();
    this.accountService = new AccountService();
  }

  public deposit = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userId = (req as any).user.userId;
      if (!userId) throw new Error("Unauthorized");

      const { accountId, amount, description } = req.body as IDeposit;

      const belongs = await this.accountService.accountBelongsToUser(
        accountId,
        userId
      );
      if (!belongs) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      const transaction = await this.transactionService.deposit({
        accountId,
        amount,
        description,
      });

      res.status(201).json(transaction);
    } catch (error) {
      res.status(400).json({ error: (error as { message: string }).message });
      return;
    }
  };

  public withdrawal = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userId = (req as any).user.userId;

      if (!userId) throw new Error("Unauthorized");

      const { accountId, amount, description } = req.body as IWithdrawal;

      const belongs = await this.accountService.accountBelongsToUser(
        accountId,
        userId
      );
      if (!belongs) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      const transaction = await this.transactionService.withdrawal({
        accountId,
        amount,
        description,
      });

      res.status(201).json(transaction);
    } catch (error) {
      res.status(400).json({ error: (error as { message: string }).message });
    }
  };

  public transfer = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userId = (req as any).user.userId;

      if (!userId) throw new Error("Unauthorized");

      const { fromAccountId, toAccountId, amount, description } =
        req.body as ITransfer;

      const fromBelongs = await this.accountService.accountBelongsToUser(
        fromAccountId,
        userId
      );
      const toBelongs = await this.accountService.accountBelongsToUser(
        toAccountId,
        userId
      );

      if (!fromBelongs || !toBelongs) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      const result = await this.transactionService.transfer({
        fromAccountId,
        toAccountId,
        amount,
        description,
      });

      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: (error as { message: string }).message });
    }
  };

  public getHistory = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userId = (req as any).user.userId;

      if (!userId) throw new Error("Unauthorized");

      const { accountId, cursor, limit, type, startDate, endDate, createdAt, sort } =
        req.query as any;

      let sortField = "created_at";
      let sortDirection: "ASC" | "DESC" = "DESC";

      if (sort && typeof sort === "string") {
        if (sort.startsWith("-")) {
          sortField = sort.substring(1);
          sortDirection = "DESC";
        } else {
          sortField = sort;
          sortDirection = "ASC";
        }
      }

      const transactions = await this.transactionService.getHistory(userId, {
        accountId: accountId ? parseInt(accountId) : undefined,
        cursor,
        limit: limit ? parseInt(limit) : 10,
        typeFilter: type as any,
        startDate,
        endDate,
        createdAt,
        sortField,
        sortDirection,
      });

      let nextCursor: string | number | null = null;
      if (transactions.length > 0) {
        const lastTransaction = transactions[transactions.length - 1];
        nextCursor = lastTransaction[
          sortField as keyof typeof lastTransaction
        ] as any;

        if (lastTransaction.created_at instanceof Date) {
          nextCursor = lastTransaction.created_at.toISOString();
        }
      }

      const pagination: ITransactionPagination = {
        nextCursor,
        hasMore: transactions.length === (limit ? parseInt(limit) : 10),
        limit: limit ? parseInt(limit) : 10,
        sortField,
        sortDirection,
      };

      res.json({
        transactions,
        pagination,
      });
    } catch (error) {
      res.status(500).json({ error: (error as { message: string }).message });
    }
  };

  public deleteTransaction = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userId = (req as any).user.userId;

      if (!userId) throw new Error("Unauthorized");

      const { transactionId } = req.params;

      const success = await this.transactionService.deleteTransaction(
        userId,
        parseInt(transactionId)
      );
      if (success) {
        res.json({ message: "Transaction deleted successfully" });
      } else {
        res.status(400).json({ error: "Failed to delete transaction" });
      }
    } catch (error) {
      res.status(400).json({ error: (error as { message: string }).message });
    }
  };
}
