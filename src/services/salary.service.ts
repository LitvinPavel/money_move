import axios from "axios";
import {
  ISalary,
  IVacation,
  ISalaryCalculationResult,
} from "../interfaces/salary.interface";
import pool from "../db";

interface ICalendarResponse {
  year: number;
  months: {
    month: number;
    days: string;
  }[];
  transitions: {
    from: string;
    to: string;
  }[];
}

export class SalaryService {
  private readonly CALENDAR_API_URL = 'https://xmlcalendar.ru/data/ru';

  // Основной метод с обработкой таймаутов
  async calculateSalaryForMonth(
    userId: number,
    date: Date
  ): Promise<ISalaryCalculationResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s общий таймаут

      const result = await Promise.race([
        this.calculateSalary(userId, date),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Calculation timeout")), 15000))
      ]);

      clearTimeout(timeout);
      return result as ISalaryCalculationResult;
    } catch (error) {
      console.error("Calculation failed:", error);
      throw new Error(`Salary calculation canceled: ${error}`);
    }
  }
  // Основной метод расчета зарплаты за месяц
  private async calculateSalary(
    userId: number,
    date: Date
  ): Promise<ISalaryCalculationResult> {
    const [currentSalary, workCalendar, vacations] = await Promise.all([
      this.getCurrentSalary(userId, date),
      this.getWorkCalendar(date),
      this.getUserVacations(userId, date),
    ]);

    const { advanceHours, salaryHours, vacationDays } = await this.calculateWorkHours(
      date,
      workCalendar,
      vacations
    );

    const [advanceHourlyRate, salaryHourlyRate, averageHourlyRate] = await Promise.all([
      currentSalary.base_salary / await this.calculateStandardWorkHours(date, workCalendar),
      currentSalary.base_salary / await this.calculateStandardWorkHours(
        new Date(date.getFullYear(), date.getMonth() - 1, 1), 
        workCalendar
      ),
      this.calculateAverageHourlyRate(userId, date),
    ]);

    const advanceAmount = advanceHours * advanceHourlyRate;
    const salaryAmount = salaryHours * salaryHourlyRate;

    let vacationPay = undefined;
    if (vacationDays > 0 && vacations.length > 0) {
      // Находим первый день отпуска
      const firstVacationDay = vacations.reduce((earliest, vacation) => 
        vacation.start_date < earliest.start_date ? vacation : earliest
      ).start_date;

      // Вычисляем последний рабочий день перед отпуском
      const paymentDate = await this.getLastWorkDayBefore(firstVacationDay, workCalendar);
      vacationPay = {
        amount: vacationDays * 8 * averageHourlyRate,
        days: vacationDays,
        averageHourlyRate,
        paymentDate
      };
    }

    const [advancePaymentDate, salaryPaymentDate] = await Promise.all([
      this.calculatePaymentDate(date, 27, workCalendar),
      this.calculatePaymentDate(date, 12, workCalendar),
    ]);

    return {
      advance: {
        amount: advanceAmount,
        paymentDate: advancePaymentDate,
        hours: advanceHours,
        hourlyRate: advanceHourlyRate,
      },
      salary: {
        amount: salaryAmount,
        paymentDate: salaryPaymentDate,
        hours: salaryHours,
        hourlyRate: salaryHourlyRate,
      },
      vacationPay,
      total: advanceAmount + salaryAmount + (vacationPay?.amount || 0),
    };
  }

  // Новый метод для определения последнего рабочего дня перед указанной датой
private async getLastWorkDayBefore(
  date: Date, 
  workCalendar: Map<string, number>
): Promise<Date> {
  let lastWorkDay = new Date(date);
  lastWorkDay.setDate(lastWorkDay.getDate() - 1); // Начинаем проверку с предыдущего дня

  // Ищем ближайший рабочий день (максимум 30 дней назад для безопасности)
  for (let i = 0; i < 30; i++) {
    if (await this.isWorkDay(lastWorkDay, workCalendar)) {
      return lastWorkDay;
    }
    lastWorkDay.setDate(lastWorkDay.getDate() - 1);
  }

  throw new Error("Could not find work day before vacation");
}

  // Получение календаря с xmlcalendar.ru
  private async getWorkCalendar(date: Date): Promise<Map<string, number>> {
    const year = date.getFullYear();
    const cacheKey = `workdays_${year}`;
    
    // Проверка кэша
    const cachedResult = await pool.query(
      `SELECT data FROM calendar_cache WHERE key = $1 AND expires_at > NOW()`,
      [cacheKey]
    );

    if (cachedResult.rows.length > 0) {
      return new Map(JSON.parse(cachedResult.rows[0].data));
    }

    try {
      const response = await axios.get<ICalendarResponse>(
        `${this.CALENDAR_API_URL}/${year}/calendar.json`,
        { timeout: 5000 }
      );

      const calendarData = response.data;
      const workDaysMap = new Map<string, number>();

      // Инициализация всех дней как рабочих (0)
      const currentDate = new Date(year, 0, 1);
      while (currentDate.getFullYear() === year) {
        const dateStr = currentDate.toISOString().split('T')[0];
        workDaysMap.set(dateStr, 0);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Помечаем стандартные выходные (суббота, воскресенье)
      currentDate.setFullYear(year, 0, 1);
      while (currentDate.getFullYear() === year) {
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
          const dateStr = currentDate.toISOString().split('T')[0];
          workDaysMap.set(dateStr, 1);
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Обрабатываем праздники и сокращенные дни
      for (const monthData of calendarData.months) {
        const days = monthData.days.split(',');
        for (const dayStr of days) {
          const day = dayStr.replace('*', '').replace('+', '');
          const date = new Date(year, monthData.month - 1, parseInt(day));
          const dateStr = date.toISOString().split('T')[0];
          
          if (dayStr.includes('*')) {
            workDaysMap.set(dateStr, 2); // Сокращенный день
          } else if (dayStr.includes('+')) {
            workDaysMap.set(dateStr, 1); // Перенесенный выходной
          } else {
            workDaysMap.set(dateStr, 1); // Праздник/выходной
          }
        }
      }

      // Обрабатываем переносы рабочих дней
      for (const transition of calendarData.transitions) {
        const [fromDay, fromMonth] = transition.from.split('.').map(Number);
        const [toDay, toMonth] = transition.to.split('.').map(Number);
        
        const fromDate = new Date(year, fromMonth - 1, fromDay);
        const toDate = new Date(year, toMonth - 1, toDay);
        
        const fromDateStr = fromDate.toISOString().split('T')[0];
        const toDateStr = toDate.toISOString().split('T')[0];
        
        const fromStatus = workDaysMap.get(fromDateStr) || 0;
        workDaysMap.set(toDateStr, fromStatus);
        workDaysMap.set(fromDateStr, 1);
      }

      // Сохраняем в кэш
      await pool.query(
        `INSERT INTO calendar_cache (key, data, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET data = $2, expires_at = $3`,
        [cacheKey, JSON.stringify(Array.from(workDaysMap.entries())), new Date(year + 1, 0, 1)]
      );

      return workDaysMap;
    } catch (error) {
      console.error('Failed to fetch calendar data:', error);
      return this.generateDefaultCalendar(year);
    }
  }

  // Генерация календаря по умолчанию
  private generateDefaultCalendar(year: number): Map<string, number> {
    const calendar = new Map<string, number>();
    const date = new Date(year, 0, 1);
    
    while (date.getFullYear() === year) {
      const dayOfWeek = date.getDay();
      const dateStr = date.toISOString().split('T')[0];
      calendar.set(dateStr, dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0);
      date.setDate(date.getDate() + 1);
    }
    
    return calendar;
  }

  // Получение текущего оклада
  private async getCurrentSalary(userId: number, date: Date): Promise<ISalary> {
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

  // Получение отпусков пользователя
  private async getUserVacations(userId: number, date: Date): Promise<IVacation[]> {
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

  // Расчет стандартных рабочих часов
  private async calculateStandardWorkHours(
    date: Date,
    workCalendar: Map<string, number>
  ): Promise<number> {
    let totalHours = 0;
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    for (let day = new Date(monthStart); day <= monthEnd; day.setDate(day.getDate() + 1)) {
      const dayType = await this.getDayType(day, workCalendar);
      if (dayType === 0) totalHours += 8;
      else if (dayType === 2) totalHours += 7;
    }

    return totalHours;
  }

  // Определение типа дня
  private async getDayType(date: Date, workCalendar: Map<string, number>): Promise<number> {
    const dateStr = date.toISOString().split('T')[0];
    return workCalendar.get(dateStr) ?? (date.getDay() === 0 || date.getDay() === 6 ? 1 : 0);
  }

  // Проверка рабочего дня
  private async isWorkDay(date: Date, workCalendar: Map<string, number>): Promise<boolean> {
    const dayType = await this.getDayType(date, workCalendar);
    return dayType === 0 || dayType === 2;
  }

  // Получение рабочих часов в день
  private async getDailyWorkHours(date: Date, workCalendar: Map<string, number>): Promise<number> {
    const dayType = await this.getDayType(date, workCalendar);
    return dayType === 2 ? 7 : 8;
  }

  // Расчет даты выплаты
  private async calculatePaymentDate(
    baseDate: Date,
    dayOfMonth: number,
    workCalendar: Map<string, number>
  ): Promise<Date> {
    let paymentDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), dayOfMonth);

    while (!(await this.isWorkDay(paymentDate, workCalendar))) {
      paymentDate.setDate(paymentDate.getDate() + 1);
    }

    return paymentDate;
  }

  // Расчет отработанных часов
  private async calculateWorkHours(
    date: Date,
    workCalendar: Map<string, number>,
    vacations: IVacation[]
  ): Promise<{ advanceHours: number; salaryHours: number; vacationDays: number }> {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const midMonth = new Date(date.getFullYear(), date.getMonth(), 15);

    let advanceHours = 0;
    let salaryHours = 0;
    let vacationDays = 0;

    // Текущий месяц (аванс)
    for (let day = new Date(monthStart); day <= monthEnd; day.setDate(day.getDate() + 1)) {
      const isVacationDay = vacations.some(v => day >= v.start_date && day <= v.end_date);
      if (isVacationDay) {
        vacationDays++;
        continue;
      }

      if (await this.isWorkDay(day, workCalendar) && day <= midMonth) {
        advanceHours += await this.getDailyWorkHours(day, workCalendar);
      }
    }

    // Предыдущий месяц (зарплата)
    const prevMonthStart = new Date(date.getFullYear(), date.getMonth() - 1, 16);
    const prevMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0);

    for (let day = new Date(prevMonthStart); day <= prevMonthEnd; day.setDate(day.getDate() + 1)) {
      if (await this.isWorkDay(day, workCalendar)) {
        salaryHours += await this.getDailyWorkHours(day, workCalendar);
      }
    }

    return { advanceHours, salaryHours, vacationDays };
  }

  private async calculateAverageHourlyRate(
    userId: number,
    date: Date
  ): Promise<number> {
    const threeMonthsAgo = new Date(date.getFullYear(), date.getMonth() - 3, 1);
    const lastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 0);
  
    // Получаем все оклады пользователя, упорядоченные по дате вступления в силу
    const salariesResult = await pool.query<ISalary>(
      `SELECT * FROM salaries 
       WHERE user_id = $1 AND effective_from <= $2
       ORDER BY effective_from DESC`,
      [userId, lastMonth]
    );
  
    if (salariesResult.rows.length === 0) {
      throw new Error("No salary data available for the user");
    }
  
    // Если есть хотя бы одна запись о зарплате, используем её
    const latestSalary = salariesResult.rows[0];
    
    // Если нет зарплат за последние 3 месяца, используем последнюю доступную
    if (new Date(latestSalary.effective_from) < threeMonthsAgo) {
      // console.warn(`Using last available salary from ${latestSalary.effective_from} as there are no recent records`);
      
      // Рассчитываем рабочие часы для текущего месяца
      const workCalendar = await this.getWorkCalendar(date);
      const monthHours = await this.calculateStandardWorkHours(date, workCalendar);
      
      if (monthHours === 0) {
        throw new Error("No work hours found for current month");
      }
      
      return latestSalary.base_salary / monthHours;
    }
  
    // Стандартный расчёт за последние 3 месяца
    let totalEarnings = 0;
    let totalHours = 0;
    const monthsToAnalyze: Date[] = [];
  
    for (let i = 2; i >= 0; i--) {
      monthsToAnalyze.push(new Date(date.getFullYear(), date.getMonth() - i, 1));
    }
  
    for (const monthStart of monthsToAnalyze) {
      const monthEnd = new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        0
      );
  
      // Находим актуальный оклад для этого месяца
      const salary = salariesResult.rows.find(
        (s) => new Date(s.effective_from) <= monthEnd
      );
      if (!salary) continue;
  
      const workCalendar = await this.getWorkCalendar(monthStart);
      let monthHours = 0;
  
      for (
        let day = new Date(monthStart);
        day <= monthEnd;
        day.setDate(day.getDate() + 1)
      ) {
        if (await this.isWorkDay(day, workCalendar)) {
          monthHours += await this.getDailyWorkHours(day, workCalendar);
        }
      }
  
      if (monthHours > 0) {
        totalEarnings += salary.base_salary;
        totalHours += monthHours;
      }
    }
  
    if (totalHours === 0) {
      throw new Error("No work hours found for last 3 months");
    }
  
    return totalEarnings / totalHours;
  }

  // Установка зарплаты
  // Установка нового оклада
  async setSalary(
    userId: number,
    amount: number,
    effective_from: Date
  ): Promise<ISalary> {
    try {
      const result = await pool.query<ISalary>(
        `INSERT INTO salaries (user_id, base_salary, effective_from)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, amount, effective_from]
      );

      if (result.rows.length === 0) {
        throw new Error("Failed to create salary record");
      }

      return result.rows[0];
    } catch (error) {
      console.error("Error in setSalary:", error);
      throw new Error("Database operation failed");
    }
  }

  // Добавление отпуска
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

  // Удаление отпуска
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

  // Получение истории окладов
  async getSalaryHistory(userId: number): Promise<ISalary[]> {
    try {
      const result = await pool.query<ISalary>(
        `SELECT * FROM salaries 
         WHERE user_id = $1
         ORDER BY effective_from DESC`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      console.error("Error in getSalaryHistory:", error);
      throw new Error("Database operation failed");
    }
  }

   // Получение отпусков за период
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