import { ISalary, IVacation } from "../../interfaces/salary.interface";
import pool from "../../db";

export class DbService {
  async getCurrentSalary(userId: number, date: Date): Promise<ISalary> {
    const result = await pool.query<ISalary>(
      `SELECT * FROM salaries 
       WHERE user_id = $1 AND effective_from <= $2
       ORDER BY effective_from DESC
       LIMIT 1`,
      [userId, date]
    );

    if (result.rows.length === 0) {
      throw new Error(`Salary not found for user ${userId} on ${date.toISOString()}`);
    }

    return result.rows[0];
  }

  async getUserVacations(userId: number, date: Date): Promise<IVacation[]> {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const result = await pool.query<IVacation>(
      `SELECT * FROM vacations 
       WHERE user_id = $1 AND 
             (start_date <= $2 AND end_date >= $3)`,
      [userId, monthEnd, monthStart]
    );

    return result.rows;
  }

  async setSalary(
    userId: number,
    amount: number,
    effective_from: Date
  ): Promise<ISalary> {
    try {
      const result = await pool.query(
        `INSERT INTO salaries (user_id, base_salary, effective_from)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, amount, effective_from]
      );

      if (result.rows.length === 0) {
        throw new Error("Failed to create salary record");
      }

      return { ...result.rows[0], base_salary: parseFloat(result.rows[0].base_salary) };
    } catch (error) {
      console.error("Error in setSalary:", error);
      throw new Error("Database operation failed");
    }
  }

  async addVacation(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<IVacation> {
    try {
      if (startDate > endDate) {
        throw new Error("Start date must be before end date");
      }

      const result = await pool.query<IVacation>(
        `INSERT INTO vacations (user_id, start_date, end_date)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, startDate, endDate]
      );

      if (result.rows.length === 0) {
        throw new Error("Failed to create vacation record");
      }

      return result.rows[0];
    } catch (error) {
      console.error("Error in addVacation:", error);
      throw new Error("Database operation failed");
    }
  }

  async deleteVacation(userId: number, vacationId: number): Promise<boolean> {
    try {
      const result = await pool.query(
        `DELETE FROM vacations 
         WHERE id = $1 AND user_id = $2`,
        [vacationId, userId]
      );

      return (result.rowCount as number) > 0;
    } catch (error) {
      console.error("Error in deleteVacation:", error);
      throw new Error("Database operation failed");
    }
  }

  async getSalaryHistory(userId: number): Promise<ISalary[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM salaries 
         WHERE user_id = $1
         ORDER BY effective_from DESC`,
        [userId]
      );

      return result.rows.map((row: ISalary) => ({
        ...row,
        base_salary: parseFloat(row.base_salary.toString())
      }));
    } catch (error) {
      console.error("Error in getSalaryHistory:", error);
      throw new Error("Database operation failed");
    }
  }

  async getVacations(
    userId: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<IVacation[]> {
    try {
      let queryText = `SELECT * FROM vacations WHERE user_id = $1`;
      const params: any[] = [userId];

      if (startDate) {
        queryText += ` AND end_date >= $${params.length + 1}`;
        params.push(startDate);
      }

      if (endDate) {
        queryText += ` AND start_date <= $${params.length + 1}`;
        params.push(endDate);
      }

      queryText += ` ORDER BY start_date DESC`;

      const result = await pool.query<IVacation>(queryText, params);
      return result.rows;
    } catch (error) {
      console.error("Error in getVacations:", error);
      throw new Error("Database operation failed");
    }
  }
}