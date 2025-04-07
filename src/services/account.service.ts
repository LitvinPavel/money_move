import { IAccount, ICreateAccount, IUpdateAccount, TotalBalanceResponse, GroupedBalanceResponse } from "../interfaces/account.interface";
import pool from "../db";
import axios from 'axios';
import iconv from 'iconv-lite';
import { parseStringPromise, processors } from 'xml2js';

export class AccountService {
  private banksCache: {
    data: Array<{bic: string, name: string}>;
    timestamp: number;
  } | null = null;

  private async fetchAndCacheRussianBanks(): Promise<void> {
    try {
      // Проверяем, когда последний раз обновлялись данные
      const { rows } = await pool.query(
        'SELECT MAX(updated_at) as last_update FROM russian_banks'
      );
      
      const lastUpdate = rows[0]?.last_update;
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      // Если данные актуальны, пропускаем обновление
      if (lastUpdate && new Date(lastUpdate) > oneYearAgo) {
        return;
      }
      
      // Получаем данные из ЦБ РФ
      const response = await axios.get('https://www.cbr.ru/scripts/XML_bic.asp', {
        responseType: 'arraybuffer',
        responseEncoding: 'binary'
      });
      // Конвертируем в правильную кодировку
      const xmlData = iconv.decode(Buffer.from(response.data, 'binary'), 'win1251');
    
      // Парсим XML с правильными настройками
      const parsed = await parseStringPromise(xmlData, {
        explicitArray: false,
        explicitCharkey: true,
        preserveChildrenOrder: true,
        charsAsChildren: true,
        includeWhiteChars: false,
        trim: false,
        attrValueProcessors: [
          (value, name) => {
            // Особый обработчик для атрибута BIC
            if (name === 'Bic') {
              return value.toString().padStart(9, '0');
            }
            return value;
          }
        ],
      });

      // Начинаем транзакцию
      await pool.query('BEGIN');
      
      try {
        // Очищаем старые данные
        await pool.query('TRUNCATE russian_banks');
        console.log(parsed.BicCode.Record)
        // Вставляем новые данные
        const records = Array.isArray(parsed.BicCode.Record) 
        ? parsed.BicCode.Record 
        : [parsed.BicCode.Record];

        for (const record of records) {
          // Обеспечиваем правильный формат BIC (9 цифр, с ведущими нулями)
          let bic = record.Bic._;
          if (typeof bic === 'number') {
            bic = bic.toString().padStart(9, '0');
          } else if (typeof bic === 'string') {
            bic = bic.padStart(9, '0');
          } else {
            continue;
          }

          const name = record.ShortName._?.trim();
          
          if (bic.length !== 9 || !/^\d+$/.test(bic)) {
            console.warn(`Invalid BIC format: ${bic}`);
            continue;
          }

          if (!name) {
            console.warn(`Empty name for BIC: ${bic}`);
            continue;
          }
          await pool.query(
            'INSERT INTO russian_banks (bic, name) VALUES ($1, $2)',
            [bic, name]
          );
        }
        
        await pool.query('COMMIT');
        console.log('Russian banks data updated successfully');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('Failed to update Russian banks data:', error);
    }
  }

  async getRussianBanks(): Promise<Array<{bic: string, name: string}>> {
    if (this.banksCache && Date.now() - this.banksCache.timestamp < 3600000) {
      return this.banksCache.data;
    }
    await this.fetchAndCacheRussianBanks();
    
    const { rows } = await pool.query(
      'SELECT bic, name FROM russian_banks ORDER BY name'
    );

    this.banksCache = {
      data: rows,
      timestamp: Date.now()
    };
    
    return rows;
  }

  async createAccount(userId: number, data: ICreateAccount): Promise<IAccount> {
    const { 
      currency, 
      initialBalance = 0, 
      account_name, 
      bank_bic,
      type,
      plan = 0,
      interest_rate = null,
      is_salary = false
    } = data;
    
    // Получаем название банка по БИК
    const bank = await this.getBankByBic(bank_bic);
    
    const { rows } = await pool.query<IAccount>(
      `INSERT INTO bank_accounts 
       (user_id, account_number, balance, currency, account_name, bank_bic, bank_name, type, plan, interest_rate, is_salary) 
       VALUES ($1, generate_account_number(), $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id, account_number, balance, currency, account_name, bank_bic, bank_name,
                 type, plan, interest_rate, is_salary, created_at`,
      [
        userId, 
        initialBalance, 
        currency, 
        account_name, 
        bank_bic,
        bank.name,
        type,
        plan,
        type === 'deposit' ? null : interest_rate,
        is_salary
      ]
    );
    return rows[0];
  }

  private async getBankByBic(bic: string): Promise<{bic: string, name: string}> {
    const { rows } = await pool.query(
      'SELECT bic, name FROM russian_banks WHERE bic = $1',
      [bic]
    );
    
    if (rows.length === 0) {
      throw new Error('Bank with this BIC not found');
    }
    
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

    // Добавляем обработку is_salary
    if (updateData.is_salary !== undefined) {
      setClauses.push(`is_salary = $${paramIndex}`);
      values.push(updateData.is_salary);
      paramIndex++;
    }
  
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

    if (updateData.bank_bic !== undefined) {
      // Получаем название банка по новому БИК
      const bank = await this.getBankByBic(updateData.bank_bic);
      setClauses.push(`bank_bic = $${paramIndex}`, `bank_name = $${paramIndex + 1}`);
      values.push(updateData.bank_bic, bank.name);
      paramIndex += 2;
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
                 account_name, bank_bic, bank_name, type, plan, interest_rate, is_salary, created_at AS "createdAt"`,
      values
    );
  
    return rows[0];
  }

  async getAccounts(
    userId: number, 
    filters?: {
      type?: string;
      bank_bic?: string;
    }
  ): Promise<IAccount[]> {
    let query = `
      SELECT id, account_number, balance, currency, 
             account_name, bank_bic, bank_name, type, plan, interest_rate, is_salary
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

    if (filters?.bank_bic) {
      query += ` AND bank_bic = $${paramIndex}`;
      params.push(filters.bank_bic);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const { rows } = await pool.query<IAccount>(query, params);
    return rows;
  }

  async getTotalBalance(
    userId: number,
    groupBy?: 'type' | 'bank_bic'
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

  async getRussianBanksPaginated(
    searchTerm?: string,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{
    banks: Array<{bic: string, name: string}>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    await this.fetchAndCacheRussianBanks();
    
    let query = 'SELECT bic, name FROM russian_banks';
    let countQuery = 'SELECT COUNT(*) FROM russian_banks';
    const params: any[] = [];
    
    if (searchTerm) {
      const searchCondition = `
        WHERE LOWER(name) LIKE LOWER($1) 
        OR bic LIKE LOWER($1)
      `;
      query += searchCondition;
      countQuery += searchCondition;
      params.push(`%${searchTerm}%`);
    }
    
    // Добавляем сортировку и пагинацию
    query += ` ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pageSize, (page - 1) * pageSize);
    
    const [banksResult, countResult] = await Promise.all([
      pool.query<{bic: string, name: string}>(query, params),
      pool.query<{count: string}>(countQuery, params.slice(0, searchTerm ? 1 : 0))
    ]);
    
    return {
      banks: banksResult.rows,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      page,
      pageSize
    };
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