import { IAccount, ICreateAccount, IUpdateAccount, TotalBalanceResponse, GroupedBalanceResponse } from "../interfaces/account.interface";
import pool from "../db";

export class AccountService {
  async createAccount(userId: number, data: ICreateAccount): Promise<IAccount> {
    const { 
      currency, 
      initialBalance = 0, 
      account_name, 
      bank_name,
      type,
      plan = 0,
      interest_rate = null
    } = data;
    
    const { rows } = await pool.query<IAccount>(
      `INSERT INTO bank_accounts 
       (user_id, account_number, balance, currency, account_name, bank_name, type, plan, interest_rate) 
       VALUES ($1, generate_account_number(), $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, account_number, balance, currency, account_name, bank_name, 
                 type, plan, interest_rate, created_at`,
      [
        userId, 
        initialBalance, 
        currency, 
        account_name, 
        bank_name,
        type,
        plan,
        type === 'deposit' ? null : interest_rate
      ]
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

    if (updateData.type !== undefined) {
      setClauses.push(`type = $${paramIndex}`);
      values.push(updateData.type);
      paramIndex++;
    }

    if (updateData.plan !== undefined) {
      setClauses.push(`plan = $${paramIndex}`);
      values.push(updateData.plan);
      paramIndex++;
    }

    if (updateData.interest_rate !== undefined) {
      setClauses.push(`interest_rate = $${paramIndex}`);
      values.push(updateData.interest_rate);
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
                 account_name, bank_name, type, plan, interest_rate, created_at AS "createdAt"`,
      values
    );
  
    return rows[0];
  }

  async getAccounts(
    userId: number, 
    filters?: {
      type?: string;
      bank_name?: string;
    }
  ): Promise<IAccount[]> {
    let query = `
      SELECT id, account_number, balance, currency, 
             account_name, bank_name, type, plan, interest_rate
      FROM bank_accounts 
      WHERE user_id = $1
    `;
    
    const params: any[] = [userId];
    let paramIndex = 2;

    if (filters?.type) {
      query += ` AND type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters?.bank_name) {
      query += ` AND bank_name = $${paramIndex}`;
      params.push(filters.bank_name);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const { rows } = await pool.query<IAccount>(query, params);
    return rows;
  }

  async getTotalBalance(
    userId: number,
    groupBy?: 'type' | 'bank_name'
  ): Promise<TotalBalanceResponse | GroupedBalanceResponse> {
    const params: any[] = [userId];
  
    if (!groupBy) {
      // Общая сумма без группировки
      const { rows } = await pool.query<{ total: string }>(`
        SELECT SUM(balance) as total
        FROM bank_accounts
        WHERE user_id = $1
      `, params);
      
      return { total: Number(rows[0]?.total) || 0 };
    }
  
    // Группировка по указанному полю
    const { rows } = await pool.query<{ [key: string]: string, total: string }>(`
      SELECT ${groupBy}, SUM(balance) as total
      FROM bank_accounts
      WHERE user_id = $1
      GROUP BY ${groupBy}
    `, params);
  
    // Преобразуем результат в объект с числовыми значениями
    const result: { [key: string]: number } = {};
    rows.forEach(row => {
      result[row[groupBy]] = Number(row.total);
    });
  
    return result;
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