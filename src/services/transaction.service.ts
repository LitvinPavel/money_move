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

      return { ...transaction,  amount: parseFloat(transaction.amount.toString())};
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
      return { ...transaction,  amount: parseFloat(transaction.amount.toString())};
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
       VALUES ($1, $2, $3, $4, 'transfer_in', $5, $6, false, $7)
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
          amount: parseFloat(outTransaction.amount.toString()),
          related_account_name: inTransaction.account_name,
          related_bank_name: inTransaction.bank_name
        },
        inTransaction: {
          ...inTransaction,
          amount: parseFloat(inTransaction.amount.toString())
        },
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
      date?: Date | string;
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
  
      if (updateData.date !== undefined) {
        const dateValue = updateData.date instanceof Date 
          ? updateData.date 
          : new Date(updateData.date);
        setClauses.push(`date = $${paramIndex}`);
        values.push(dateValue);
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
         RETURNING id, amount, type, status, description, created_at, updated_at, bank_name, is_debt, account_name, date`,
        values
      );
  
      // 5. Для переводов обновляем связанную транзакцию (статус и дату)
      if (
        transaction.type.includes("transfer") &&
        transaction.related_transaction_id
      ) {
        const relatedUpdateClauses: string[] = [];
        const relatedUpdateValues: any[] = [];
        let relatedParamIndex = 1;
  
        if (updateData.status) {
          relatedUpdateClauses.push(`status = $${relatedParamIndex}`);
          relatedUpdateValues.push(updateData.status);
          relatedParamIndex++;
        }
  
        if (updateData.date) {
          const dateValue = updateData.date instanceof Date 
            ? updateData.date 
            : new Date(updateData.date);
          relatedUpdateClauses.push(`date = $${relatedParamIndex}`);
          relatedUpdateValues.push(dateValue);
          relatedParamIndex++;
        }
  
        if (relatedUpdateClauses.length > 0) {
          relatedUpdateValues.push(transaction.related_transaction_id);
          await pool.query(
            `UPDATE transactions
             SET ${relatedUpdateClauses.join(", ")}, updated_at = NOW()
             WHERE id = $${relatedParamIndex}`,
            relatedUpdateValues
          );
        }
      }
  
      await pool.query("COMMIT");
      return { ...updatedTransaction, amount: parseFloat(updatedTransaction.amount.toString()) };
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
          ELSE NULL
        END AS related_account_name,
        CASE 
          WHEN t.type = 'transfer_out' THEN a2.bank_name
          ELSE NULL
        END AS related_bank_name
      FROM transactions t
      JOIN bank_accounts ba ON t.account_id = ba.id
      LEFT JOIN bank_accounts a2 ON t.related_account_id = a2.id
      WHERE ba.user_id = $1
      AND t.type != 'transfer_in'
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

  async getBalanceSummary(
    userId: number,
    options: {
      accountId?: number;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<{
    totalBalance: number;
    totalDebt: number;
    netBalance: number;
    byAccount: Array<{
      accountId: number;
      accountName: string;
      bankName: string;
      balance: number;
      debt: number;
      netBalance: number;
    }>;
  }> {
    const { accountId, startDate, endDate } = options;
  
    // Базовый запрос для получения информации о счетах
    let queryText = `
      SELECT 
        ba.id as account_id,
        ba.account_name,
        ba.bank_name,
        ba.balance,
        ba.debt,
        ba.balance - ba.debt as net_balance
      FROM bank_accounts ba
      WHERE ba.user_id = $1
    `;
    const queryParams: any[] = [userId];
  
    if (accountId) {
      queryText += ` AND ba.id = $2`;
      queryParams.push(accountId);
    }
  
    const { rows: accounts } = await pool.query(queryText, queryParams);
    
    // Если нужна фильтрация по дате, вычисляем изменения баланса за период
    if (startDate || endDate) {
      for (const account of accounts) {
        let transactionQuery = `
          SELECT 
            SUM(CASE 
              WHEN type = 'deposit' THEN amount
              WHEN type = 'transfer_in' THEN amount
              WHEN type = 'withdrawal' THEN -amount
              WHEN type = 'transfer_out' THEN -amount
              ELSE 0
            END) as balance_change
          FROM transactions t
          WHERE t.account_id = $1
        `;
        const transactionParams: any[] = [account.account_id];
  
        let paramIndex = 2;
        if (startDate) {
          transactionQuery += ` AND t.date >= $${paramIndex}`;
          transactionParams.push(new Date(startDate).toISOString());
          paramIndex++;
        }
        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          transactionQuery += ` AND t.date < $${paramIndex}`;
          transactionParams.push(endDateObj.toISOString());
        }
        
        const { rows: [balanceChange] } = await pool.query(transactionQuery, transactionParams);
        
        // Корректируем баланс на основе транзакций за период
        if (balanceChange && balanceChange.balance_change) {
          account.balance = parseFloat(balanceChange.balance_change);
          account.net_balance = account.balance;
        } else {
          account.balance = 0;
          account.net_balance = 0;
        }
      }
    }
    // Рассчитываем итоговые значения
    const totalBalance = parseFloat(accounts.reduce((sum, acc) => sum + acc.balance, 0));
    const totalDebt = parseFloat(accounts.reduce((sum, acc) => sum + acc.debt, 0));
    const netBalance = totalBalance - totalDebt;
  
    return {
      totalBalance,
      totalDebt,
      netBalance,
      byAccount: accounts.map(acc => ({
        accountId: acc.account_id,
        accountName: acc.account_name,
        bankName: acc.bank_name,
        balance: parseFloat(acc.balance),
        debt: parseFloat(acc.debt),
        netBalance: parseFloat(acc.net_balance),
      })),
    };
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
                t.related_account_id, t.amount, t.bank_name, t.is_debt,
                ba.user_id as account_owner
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
          `SELECT id, type, account_id, amount, bank_name, is_debt 
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
  
        // Возвращаем деньги на счета и корректируем debt
        await pool.query(
          `UPDATE bank_accounts 
           SET balance = balance + $1
           ${outTransaction.is_debt ? `, debt = debt - $1` : ""}
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
        // Для обычных транзакций возвращаем деньги и корректируем debt
        if (transaction.type === "withdrawal") {
          await pool.query(
            `UPDATE bank_accounts 
             SET balance = balance + $1
             ${transaction.is_debt ? `, debt = debt - $1` : ""}
             WHERE id = $2`,
            [transaction.amount, transaction.account_id]
          );
        } else if (transaction.type === "deposit") {
          // Для депозитов с is_debt уменьшаем debt, иначе просто уменьшаем баланс
          if (transaction.is_debt) {
            // Получаем текущий долг для проверки
            const debtCheck = await pool.query(
              `SELECT debt FROM bank_accounts WHERE id = $1`,
              [transaction.account_id]
            );
            const currentDebt = parseFloat(debtCheck.rows[0].debt);
  
            // Если текущий долг меньше суммы транзакции, корректируем только на величину долга
            const adjustmentAmount = Math.min(transaction.amount, currentDebt);
            
            await pool.query(
              `UPDATE bank_accounts 
               SET balance = balance - $1,
                   debt = debt + $2
               WHERE id = $3`,
              [transaction.amount, adjustmentAmount, transaction.account_id]
            );
          } else {
            await pool.query(
              `UPDATE bank_accounts 
               SET balance = balance - $1 
               WHERE id = $2`,
              [transaction.amount, transaction.account_id]
            );
          }
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
