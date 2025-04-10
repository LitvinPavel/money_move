import {
  ITransaction,
  IDeposit,
  IWithdrawal,
  ITransfer,
  ITransactionOptions,
} from "../interfaces/transaction.interface";
import pool from "../db";

export class TransactionService {
  async deposit(data: IDeposit): Promise<ITransaction> {
    await pool.query("BEGIN");

    try {
      // Получаем информацию о банке и текущем долге
      const {
        rows: [account],
      } = await pool.query<{ bank_name: string; debt: number }>(
        "SELECT bank_name, debt FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.accountId]
      );

      const {
        rows: [transaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
       (account_id, amount, type, description, bank_name, is_debt, date) 
       VALUES ($1, $2, 'deposit', $3, $4, $5, $6)
       RETURNING id, amount, type, status, description, created_at, updated_at, bank_name, is_debt, account_name, date`,
        [
          data.accountId,
          data.amount,
          data.description,
          account.bank_name,
          data.is_debt || false,
          data.date || new Date(), // Use provided date or current date
        ]
      );

      if (data.is_debt && account.debt > 0) {
        // Для долгового пополнения уменьшаем долг (но не ниже 0)
        const amountToReduce = Math.min(data.amount, account.debt);
        await pool.query(
          `UPDATE bank_accounts 
         SET balance = balance + $1,
             debt = debt - $2
         WHERE id = $3`,
          [data.amount, amountToReduce, data.accountId]
        );
      } else {
        // Обычное пополнение - увеличиваем баланс
        await pool.query(
          `UPDATE bank_accounts 
         SET balance = balance + $1 
         WHERE id = $2`,
          [data.amount, data.accountId]
        );
      }

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
      // Получаем информацию о балансе, банке и текущем долге
      const {
        rows: [account],
      } = await pool.query<{
        balance: number;
        bank_name: string;
        debt: number;
      }>(
        "SELECT balance, bank_name, debt FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.accountId]
      );

      if (account.balance < data.amount) {
        throw new Error("Insufficient funds");
      }

      const {
        rows: [transaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
       (account_id, amount, type, description, bank_name, is_debt, date) 
       VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6)
       RETURNING id, amount, type, status, description, created_at, updated_at, bank_name, is_debt, account_name, date`,
        [
          data.accountId,
          data.amount,
          data.description,
          account.bank_name,
          data.is_debt || false,
          data.date || new Date(), // Use provided date or current date
        ]
      );

      // Всегда уменьшаем баланс
      await pool.query(
        `UPDATE bank_accounts 
       SET balance = balance - $1
       ${data.is_debt ? `, debt = debt + $1` : ""}
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
      } = await pool.query<{
        balance: number;
        currency: string;
        bank_name: string;
        debt: number;
      }>(
        "SELECT balance, currency, bank_name, debt FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.fromAccountId]
      );

      if (fromAccount.balance < data.amount) {
        throw new Error("Insufficient funds");
      }

      // Проверяем и блокируем целевой счет
      const {
        rows: [toAccount],
      } = await pool.query<{ currency: string; bank_name: string }>(
        "SELECT currency, bank_name FROM bank_accounts WHERE id = $1 FOR UPDATE",
        [data.toAccountId]
      );

      if (fromAccount.currency !== toAccount.currency) {
        throw new Error("Currency mismatch");
      }

      const transactionDate = data.date || new Date();

      // Создаем исходящую транзакцию
      const {
        rows: [outTransaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
       (account_id, related_account_id, amount, type, description, bank_name, is_debt, date) 
       VALUES ($1, $2, $3, 'transfer_out', $4, $5, $6, $7)
       RETURNING id, amount, type, status, description, created_at, updated_at, bank_name, is_debt, account_name, date`,
        [
          data.fromAccountId,
          data.toAccountId,
          data.amount,
          data.description,
          fromAccount.bank_name,
          data.is_debt || false,
          transactionDate,
        ]
      );

      // Создаем входящую транзакцию
      const {
        rows: [inTransaction],
      } = await pool.query<ITransaction>(
        `INSERT INTO transactions 
       (account_id, related_account_id, related_transaction_id, amount, type, description, bank_name, is_debt, date) 
       VALUES ($1, $2, $3, $4, 'transfer_in', $5, $6, false, $7)  // is_debt всегда false для входящего перевода
       RETURNING id, amount, type, status, description, created_at, updated_at, bank_name, is_debt, account_name, date`,
        [
          data.toAccountId,
          data.fromAccountId,
          outTransaction.id,
          data.amount,
          data.description,
          toAccount.bank_name,
          transactionDate,
        ]
      );

      // Обновляем исходящую транзакцию
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
       ${data.is_debt ? `, debt = debt + $1` : ""}
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
        outTransaction: {
          ...outTransaction,
          related_account_name: inTransaction.account_name,
          related_bank_name: inTransaction.bank_name
        },
        inTransaction,
      };
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async updateTransaction(
    userId: number,
    transactionId: number,
    updateData: {
      description?: string;
      status?: string;
      is_debt?: boolean;
    }
  ): Promise<ITransaction> {
    await pool.query("BEGIN");

    try {
      // 1. Проверяем существование транзакции и права доступа
      const { rows } = await pool.query<{
        id: number;
        type: string;
        related_transaction_id: number | null;
      }>(
        `SELECT t.id, t.type, t.related_transaction_id
         FROM transactions t
         JOIN bank_accounts ba ON t.account_id = ba.id
         WHERE t.id = $1 AND ba.user_id = $2`,
        [transactionId, userId]
      );

      if (rows.length === 0) {
        throw new Error("Transaction not found or access denied");
      }

      const transaction = rows[0];

      // 2. Для переводов проверяем доступ к связанной транзакции
      if (
        transaction.type.includes("transfer") &&
        transaction.related_transaction_id
      ) {
        const relatedAccess = await pool.query(
          `SELECT 1 FROM transactions t
           JOIN bank_accounts ba ON t.account_id = ba.id
           WHERE t.id = $1 AND ba.user_id = $2`,
          [transaction.related_transaction_id, userId]
        );

        if (relatedAccess.rows.length === 0) {
          throw new Error("No access to related transaction");
        }
      }

      // 3. Подготавливаем поля для обновления
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updateData.description !== undefined) {
        setClauses.push(`description = $${paramIndex}`);
        values.push(updateData.description);
        paramIndex++;
      }

      if (updateData.status !== undefined) {
        setClauses.push(`status = $${paramIndex}`);
        values.push(updateData.status);
        paramIndex++;
      }

      if (updateData.is_debt !== undefined) {
        setClauses.push(`is_debt = $${paramIndex}`);
        values.push(updateData.is_debt);
        paramIndex++;
      }

      if (setClauses.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(transactionId);
      const setClause = setClauses.join(", ");

      // 4. Обновляем транзакцию
      const {
        rows: [updatedTransaction],
      } = await pool.query<ITransaction>(
        `UPDATE transactions
         SET ${setClause}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, amount, type, status, description, created_at, updated_at, bank_name, is_debt, account_name`,
        values
      );

      // 5. Для переводов обновляем связанную транзакцию (только статус)
      if (
        transaction.type.includes("transfer") &&
        transaction.related_transaction_id &&
        updateData.status
      ) {
        await pool.query(
          `UPDATE transactions
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [updateData.status, transaction.related_transaction_id]
        );
      }

      await pool.query("COMMIT");
      return updatedTransaction;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async getHistory(
    userId: number,
    options: ITransactionOptions
  ): Promise<ITransaction[]> {
    const {
      accountId,
      cursor,
      limit = 10,
      typeFilter,
      startDate,
      endDate,
      date,
      sortField = "date",
      sortDirection = "DESC",
    } = options;
  
    // Validate sort parameters
    const validSortFields = ["date", "amount", "type"];
    const validSortDirections = ["ASC", "DESC"];
  
    const effectiveSortField = validSortFields.includes(sortField)
      ? sortField
      : "date";
    const effectiveSortDirection = validSortDirections.includes(sortDirection)
      ? sortDirection
      : "DESC";
  
    // Base query
    let queryText = `
      SELECT 
        t.id,
        t.amount,
        t.type,
        t.status,
        t.description,
        t.created_at,
        t.updated_at,
        t.is_debt,
        t.bank_name,
        t.date,
        ba.account_name,
        CASE 
          WHEN t.type = 'transfer_out' THEN a2.account_name
          WHEN t.type = 'transfer_in' THEN a2.account_name
          ELSE NULL
        END AS related_account_name,
        CASE 
          WHEN t.type = 'transfer_out' THEN a2.bank_name
          WHEN t.type = 'transfer_in' THEN a2.bank_name
          ELSE NULL
        END AS related_bank_name
      FROM transactions t
      JOIN bank_accounts ba ON t.account_id = ba.id
      LEFT JOIN bank_accounts a2 ON t.related_account_id = a2.id
      WHERE ba.user_id = $1
    `;
    const queryValues: any[] = [userId];
    let paramCounter = 2; // Start from $2 since $1 is used for userId
  
    // Add filtering conditions
    if (accountId) {
      queryText += ` AND t.account_id = $${paramCounter}`;
      queryValues.push(accountId);
      paramCounter++;
    }
  
    // Cursor pagination
    if (cursor) {
      const operator = effectiveSortDirection === "DESC" ? "<" : ">";
      queryText += ` AND t.${effectiveSortField} ${operator} $${paramCounter}`;
      queryValues.push(
        effectiveSortField === "amount" ? parseFloat(cursor as string) : cursor
      );
      paramCounter++;
    }
  
    // Transaction type filter
    if (typeFilter) {
      queryText += ` AND t.type = $${paramCounter}`;
      queryValues.push(typeFilter);
      paramCounter++;
    }
  
    // Date filtering
    if (date) {
      const dateObj = new Date(date);
      const nextDay = new Date(dateObj);
      nextDay.setDate(dateObj.getDate() + 1);
  
      queryText += ` AND t.date >= $${paramCounter} AND t.date < $${paramCounter + 1}`;
      queryValues.push(dateObj.toISOString());
      queryValues.push(nextDay.toISOString());
      paramCounter += 2;
    } else {
      if (startDate) {
        queryText += ` AND t.date >= $${paramCounter}`;
        queryValues.push(new Date(startDate).toISOString());
        paramCounter++;
      }
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1);
        queryText += ` AND t.date < $${paramCounter}`;
        queryValues.push(endDateObj.toISOString());
        paramCounter++;
      }
    }
  
    // Add sorting and limit
    queryText += ` ORDER BY t.${effectiveSortField} ${effectiveSortDirection}`;
    queryText += ` LIMIT $${paramCounter}`;
    queryValues.push(Math.min(limit, 100));
  
    // Execute query
    const { rows } = await pool.query({
      text: queryText,
      values: queryValues,
    });
  
    return rows.map((row) => ({
      ...row,
      id: parseInt(row.id, 10),
      amount: parseFloat(row.amount),
    }));
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
                t.related_account_id, t.amount, t.bank_name, ba.user_id as account_owner
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
      if (
        transaction.type === "transfer_out" ||
        transaction.type === "transfer_in"
      ) {
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
          `SELECT id, type, account_id, amount, bank_name 
           FROM transactions 
           WHERE id = $1 OR related_transaction_id = $1`,
          [transactionId]
        );

        // Проверяем, что нашли обе транзакции перевода
        if (relatedTransaction.rows.length !== 2) {
          throw new Error("Could not find both transfer transactions");
        }

        // Определяем какая транзакция какая (out или in)
        const outTransaction = relatedTransaction.rows.find(
          (t) => t.type === "transfer_out"
        );
        const inTransaction = relatedTransaction.rows.find(
          (t) => t.type === "transfer_in"
        );

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
        if (transaction.type === "withdrawal") {
          await pool.query(
            `UPDATE bank_accounts 
             SET balance = balance + $1 
             WHERE id = $2`,
            [transaction.amount, transaction.account_id]
          );
        } else if (transaction.type === "deposit") {
          await pool.query(
            `UPDATE bank_accounts 
             SET balance = balance - $1 
             WHERE id = $2`,
            [transaction.amount, transaction.account_id]
          );
        }

        // Удаляем транзакцию
        await pool.query("DELETE FROM transactions WHERE id = $1", [
          transactionId,
        ]);
      }

      await pool.query("COMMIT");
      return true;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}
