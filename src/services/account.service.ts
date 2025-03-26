import { IAccount, ICreateAccount, IUpdateAccount } from "../interfaces/account.interface";
import pool from "../db";

export class AccountService {
  async createAccount(userId: number, data: ICreateAccount): Promise<IAccount> {
    const { currency, initialBalance = 0, account_name, bank_name } = data;
    const { rows } = await pool.query<IAccount>(
      `INSERT INTO bank_accounts 
       (user_id, account_number, balance, currency, account_name, bank_name) 
       VALUES ($1, generate_account_number(), $2, $3, $4, $5) 
       RETURNING id, account_number, balance, currency, account_name, bank_name, created_at`,
      [userId, initialBalance, currency, account_name, bank_name]
    );
    return rows[0];
  }

  async updateAccount(
    userId: number,
    accountId: number,
    updateData: IUpdateAccount
  ): Promise<IAccount> {
    // Проверяем, что счет принадлежит пользователю
    const ownershipCheck = await pool.query(
      'SELECT 1 FROM bank_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );
  
    if (ownershipCheck.rows.length === 0) {
      throw new Error('Account not found or access denied');
    }
  
    // Динамическое построение запроса
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
  
    if (updateData.currency !== undefined) {
      setClauses.push(`currency = $${paramIndex}`);
      values.push(updateData.currency);
      paramIndex++;
    }
  
    if (updateData.balance !== undefined) {
      setClauses.push(`balance = $${paramIndex}`);
      values.push(updateData.balance);
      paramIndex++;
    }

    if (updateData.account_name !== undefined) {
      setClauses.push(`account_name = $${paramIndex}`);
      values.push(updateData.account_name);
      paramIndex++;
    }

    if (updateData.bank_name !== undefined) {
      setClauses.push(`bank_name = $${paramIndex}`);
      values.push(updateData.bank_name);
      paramIndex++;
    }
  
    if (setClauses.length === 0) {
      throw new Error('No fields to update');
    }
  
    values.push(accountId);
  
    const { rows } = await pool.query<IAccount>(
      `UPDATE bank_accounts 
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING id, account_number AS "accountNumber", balance, currency, 
                 account_name, bank_name, created_at AS "createdAt"`,
      values
    );
  
    return rows[0];
  }

  async getAccounts(userId: number): Promise<IAccount[]> {
    const { rows } = await pool.query<IAccount>(
      `SELECT id, account_number, balance, currency, account_name, bank_name
       FROM bank_accounts 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async deleteAccount(userId: number, accountId: number): Promise<boolean> {
    await pool.query("BEGIN");

    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM bank_accounts 
         WHERE id = $1 AND user_id = $2 AND balance = 0`,
        [accountId, userId]
      );
      if (rows.length === 0) {
        throw new Error("Account not found or balance not zero");
      }

      await pool.query("DELETE FROM bank_accounts WHERE id = $1", [accountId]);

      await pool.query("COMMIT");
      return true;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async accountBelongsToUser(
    accountId: number,
    userId: number
  ): Promise<boolean> {
    const { rows } = await pool.query(
      "SELECT 1 FROM bank_accounts WHERE id = $1 AND user_id = $2",
      [accountId, userId]
    );
    return rows.length > 0;
  }
}
