import {
  ITransaction,
  IDeposit,
  IWithdrawal,
  ITransfer,
  ITransactionHistory,
  ITransactionHistoryOptions,
} from "../interfaces/transaction.interface";
import pool from "../db";

export class TransactionService {
  async deposit(data: IDeposit): Promise<ITransaction> {
    await pool.query("BEGIN");

    try {
      const {
        rows: [transaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
         (account_id, amount, type, description) 
         VALUES ($1, $2, 'deposit', $3)
         RETURNING id, amount, type, status, description, created_at`,
        [data.accountId, data.amount, data.description]
      );

      await pool.query(
        `UPDATE bank_accounts 
         SET balance = balance + $1 
         WHERE id = $2`,
        [data.amount, data.accountId]
      );

      await pool.query("COMMIT");
      return transaction;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async withdrawal(data: IWithdrawal): Promise<ITransaction> {
    await pool.query("BEGIN");

    try {
      const {
        rows: [account],
      } = await pool.query<{ balance: number }>(
        "SELECT balance FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.accountId]
      );

      if (account.balance < data.amount) {
        throw new Error("Insufficient funds");
      }

      const {
        rows: [transaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
         (account_id, amount, type, description) 
         VALUES ($1, $2, 'withdrawal', $3)
         RETURNING id, amount, type, status, description, created_at`,
        [data.accountId, data.amount, data.description]
      );

      await pool.query(
        `UPDATE bank_accounts 
         SET balance = balance - $1 
         WHERE id = $2`,
        [data.amount, data.accountId]
      );

      await pool.query("COMMIT");
      return transaction;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async transfer(
    data: ITransfer
  ): Promise<{ outTransaction: ITransaction; inTransaction: ITransaction }> {
    await pool.query("BEGIN");
  
    try {
      // Проверяем и блокируем исходный счет
      const {
        rows: [fromAccount],
      } = await pool.query<{ balance: number; currency: string }>(
        "SELECT balance, currency FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.fromAccountId]
      );
  
      if (fromAccount.balance < data.amount) {
        throw new Error("Insufficient funds");
      }
  
      // Проверяем и блокируем целевой счет
      const {
        rows: [toAccount],
      } = await pool.query<{ currency: string }>(
        "SELECT currency FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.toAccountId]
      );
  
      if (fromAccount.currency !== toAccount.currency) {
        throw new Error("Currency mismatch");
      }
  
      // Сначала создаем исходящую транзакцию (без related_transaction_id)
      const {
        rows: [outTransaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
         (account_id, related_account_id, amount, type, description) 
         VALUES ($1, $2, $3, 'transfer_out', $4)
         RETURNING id, amount, type, status, description, created_at`,
        [data.fromAccountId, data.toAccountId, data.amount, data.description]
      );
  
      // Затем создаем входящую транзакцию, ссылаясь на исходящую
      const {
        rows: [inTransaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
         (account_id, related_account_id, related_transaction_id, amount, type, description) 
         VALUES ($1, $2, $3, $4, 'transfer_in', $5)
         RETURNING id, amount, type, status, description, created_at`,
        [data.toAccountId, data.fromAccountId, outTransaction.id, data.amount, data.description]
      );
  
      // Обновляем исходящую транзакцию, добавляя ссылку на входящую
      await pool.query(
        `UPDATE transactions 
         SET related_transaction_id = $1 
         WHERE id = $2`,
        [inTransaction.id, outTransaction.id]
      );
  
      // Обновляем балансы счетов
      await pool.query(
        `UPDATE bank_accounts 
         SET balance = balance - $1 
         WHERE id = $2`,
        [data.amount, data.fromAccountId]
      );
  
      await pool.query(
        `UPDATE bank_accounts 
         SET balance = balance + $1 
         WHERE id = $2`,
        [data.amount, data.toAccountId]
      );
  
      await pool.query("COMMIT");
      return { 
        outTransaction: { ...outTransaction, related_transaction_id: inTransaction.id },
        inTransaction 
      };
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async getHistory(
    userId: number,
    options: ITransactionHistoryOptions
  ): Promise<ITransactionHistory[]> {
    const {
      accountId,
      cursor,
      limit = 10,
      typeFilter,
      startDate,
      endDate,
      createdAt,
      sortField = "created_at",
      sortDirection = "DESC",
    } = options;
  
    // Валидация параметров сортировки
    const validSortFields = ["created_at", "amount", "type"];
    const validSortDirections = ["ASC", "DESC"];
  
    const effectiveSortField = validSortFields.includes(sortField)
      ? sortField
      : "created_at";
    const effectiveSortDirection = validSortDirections.includes(sortDirection)
      ? sortDirection
      : "DESC";
  
    // Базовый запрос
    const query: {
      text: string;
      values: any[];
    } = {
      text: `
        SELECT 
          t.id,
          t.amount,
          t.type,
          t.status,
          t.description,
          t.created_at,
          ba.account_number,
          ba.currency AS account_currency,
          CASE 
            WHEN t.type = 'transfer_out' THEN a2.account_number
            WHEN t.type = 'transfer_in' THEN a2.account_number
            ELSE NULL
          END AS related_account_number
        FROM transactions t
        JOIN bank_accounts ba ON t.account_id = ba.id
        LEFT JOIN bank_accounts a2 ON t.related_account_id = a2.id
        WHERE ba.user_id = $1
      `,
      values: [userId],
    };
  
    // Добавляем условия фильтрации
    if (accountId) {
      query.text += ` AND t.account_id = $${query.values.length + 1}`;
      query.values.push(accountId);
    }
  
    // Обработка курсора для пагинации
    if (cursor) {
      const operator = effectiveSortDirection === "DESC" ? "<" : ">";
      query.text += ` AND t.${effectiveSortField} ${operator} $${query.values.length + 1}`;
      query.values.push(
        effectiveSortField === "amount" ? parseFloat(cursor as string) : cursor
      );
    }
  
    // Фильтрация по типу транзакции
    if (typeFilter) {
      query.text += ` AND t.type = $${query.values.length + 1}`;
      query.values.push(typeFilter);
    }
  
    // Фильтрация по дате создания
    if (createdAt) {
      const date = new Date(createdAt);
      const nextDay = new Date(date);
      nextDay.setDate(date.getDate() + 1);
      
      query.text += ` AND t.created_at >= $${query.values.length + 1} AND t.created_at < $${query.values.length + 2}`;
      query.values.push(date.toISOString());
      query.values.push(nextDay.toISOString());
    } else {
      if (startDate) {
        query.text += ` AND t.created_at >= $${query.values.length + 1}`;
        query.values.push(new Date(startDate).toISOString());
      }
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1); // Добавляем 1 день, чтобы включить весь endDate
        query.text += ` AND t.created_at < $${query.values.length + 1}`;
        query.values.push(endDateObj.toISOString());
      }
    }
  
    // Добавляем сортировку и лимит
    query.text += ` ORDER BY t.${effectiveSortField} ${effectiveSortDirection}`;
    query.text += ` LIMIT $${query.values.length + 1}`;
    query.values.push(Math.min(limit, 100));
  
    // Выполняем запрос
    const { rows } = await pool.query<ITransactionHistory>(query);
    return rows;
  }

  async deleteTransaction(
    userId: number,
    transactionId: number
  ): Promise<boolean> {
    await pool.query("BEGIN");
  
    try {
      // Получаем полную информацию о транзакции с проверкой прав доступа
      const transactionQuery = await pool.query(
        `SELECT t.id, t.type, t.related_transaction_id, t.account_id, 
                t.related_account_id, t.amount, ba.user_id as account_owner
         FROM transactions t
         JOIN bank_accounts ba ON t.account_id = ba.id
         WHERE t.id = $1 AND ba.user_id = $2`,
        [transactionId, userId]
      );
  
      if (transactionQuery.rows.length === 0) {
        throw new Error("Transaction not found or access denied");
      }
  
      const transaction = transactionQuery.rows[0];
  
      // Если это перевод, находим связанную транзакцию
      if (transaction.type === 'transfer_out' || transaction.type === 'transfer_in') {
        // Проверяем, что связанный счет также принадлежит пользователю
        if (transaction.related_account_id) {
          const relatedAccountCheck = await pool.query(
            `SELECT 1 FROM bank_accounts 
             WHERE id = $1 AND user_id = $2`,
            [transaction.related_account_id, userId]
          );
  
          if (relatedAccountCheck.rows.length === 0) {
            throw new Error("Related account not found or access denied");
          }
        }
  
        // Получаем связанную транзакцию
        const relatedTransaction = await pool.query(
          `SELECT id, type, account_id, amount 
           FROM transactions 
           WHERE id = $1 OR related_transaction_id = $1`,
          [transactionId]
        );
  
        // Проверяем, что нашли обе транзакции перевода
        if (relatedTransaction.rows.length !== 2) {
          throw new Error("Could not find both transfer transactions");
        }
  
        // Определяем какая транзакция какая (out или in)
        const outTransaction = relatedTransaction.rows.find(t => t.type === 'transfer_out');
        const inTransaction = relatedTransaction.rows.find(t => t.type === 'transfer_in');
  
        if (!outTransaction || !inTransaction) {
          throw new Error("Invalid transfer transaction pair");
        }
  
        // Возвращаем деньги на счета
        await pool.query(
          `UPDATE bank_accounts 
           SET balance = balance + $1 
           WHERE id = $2`,
          [outTransaction.amount, outTransaction.account_id]
        );
  
        await pool.query(
          `UPDATE bank_accounts 
           SET balance = balance - $1 
           WHERE id = $2`,
          [inTransaction.amount, inTransaction.account_id]
        );
  
        // Удаляем обе транзакции
        await pool.query(
          `DELETE FROM transactions 
           WHERE id = $1 OR id = $2`,
          [outTransaction.id, inTransaction.id]
        );
      } else {
        // Для обычных транзакций возвращаем деньги (если это withdrawal/deposit)
        if (transaction.type === 'withdrawal') {
          await pool.query(
            `UPDATE bank_accounts 
             SET balance = balance + $1 
             WHERE id = $2`,
            [transaction.amount, transaction.account_id]
          );
        } else if (transaction.type === 'deposit') {
          await pool.query(
            `UPDATE bank_accounts 
             SET balance = balance - $1 
             WHERE id = $2`,
            [transaction.amount, transaction.account_id]
          );
        }
  
        // Удаляем транзакцию
        await pool.query(
          "DELETE FROM transactions WHERE id = $1", 
          [transactionId]
        );
      }
  
      await pool.query("COMMIT");
      return true;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}
