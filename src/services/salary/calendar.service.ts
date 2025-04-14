import axios from "axios";
import pool from "../../db";

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

export class CalendarService {
  private readonly CALENDAR_API_URL = 'https://xmlcalendar.ru/data/ru';

  async getWorkCalendar(date: Date): Promise<Map<string, number>> {
    const year = date.getFullYear();
    const cacheKey = `workdays_${year}`;
    
    const cachedResult = await pool.query(
      `SELECT data FROM calendar_cache WHERE key = $1`,
      [cacheKey]
    );

    if (cachedResult.rows.length > 0) {
      return new Map(JSON.parse(cachedResult.rows[0].data));
    }

    try {
      const response = await axios.get<ICalendarResponse>(
        `${this.CALENDAR_API_URL}/${year}/calendar.json`,
        { timeout: 50000 }
      );

      const workDaysMap = this.processCalendarData(response.data, year);

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

  private processCalendarData(data: ICalendarResponse, year: number): Map<string, number> {
    const workDaysMap = new Map<string, number>();

    // Инициализация всех дней
    const currentDate = new Date(year, 0, 1);
    while (currentDate.getFullYear() === year) {
      const dateStr = currentDate.toLocaleDateString("sv");
      workDaysMap.set(dateStr, 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Помечаем стандартные выходные
    currentDate.setFullYear(year, 0, 1);
    while (currentDate.getFullYear() === year) {
      if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        const dateStr = currentDate.toLocaleDateString("sv");
        workDaysMap.set(dateStr, 1);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Обрабатываем праздники и сокращенные дни
    for (const monthData of data.months) {
      const days = monthData.days.split(',');
      for (const dayStr of days) {
        const day = dayStr.replace('*', '').replace('+', '');
        const date = new Date(year, monthData.month - 1, parseInt(day));
        const dateStr = date.toLocaleDateString("sv");
        
        if (dayStr.includes('*')) {
          workDaysMap.set(dateStr, 2);
        } else if (dayStr.includes('+')) {
          workDaysMap.set(dateStr, 1);
        } else {
          workDaysMap.set(dateStr, 1);
        }
      }
    }

    // Обрабатываем переносы
    for (const transition of data.transitions) {
      const [fromMonth, fromDay] = transition.from.split('.').map(Number);
      const [toMonth, toDay] = transition.to.split('.').map(Number);
      
      const fromDate = new Date(year, fromMonth - 1, fromDay);
      const toDate = new Date(year, toMonth - 1, toDay);
      
      const fromDateStr = fromDate.toLocaleDateString("sv");
      const toDateStr = toDate.toLocaleDateString("sv");
      
      const fromStatus = workDaysMap.get(fromDateStr) || 0;
      workDaysMap.set(toDateStr, fromStatus);
      workDaysMap.set(fromDateStr, 1);
    }

    return workDaysMap;
  }

  private generateDefaultCalendar(year: number): Map<string, number> {
    const calendar = new Map<string, number>();
    const date = new Date(year, 0, 1);
    
    while (date.getFullYear() === year) {
      const dayOfWeek = date.getDay();
      const dateStr = date.toLocaleDateString("sv");
      calendar.set(dateStr, dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0);
      date.setDate(date.getDate() + 1);
    }
    
    return calendar;
  }

  async isWorkDay(date: Date, workCalendar: Map<string, number>): Promise<boolean> {
    const dayType = await this.getDayType(date, workCalendar);
    return dayType === 0 || dayType === 2;
  }

  async getDayType(date: Date, workCalendar: Map<string, number>): Promise<number> {
    const dateStr = date.toLocaleDateString("sv");
    return workCalendar.get(dateStr) ?? (date.getDay() === 0 || date.getDay() === 6 ? 1 : 0);
  }

  async getDailyWorkHours(date: Date, workCalendar: Map<string, number>): Promise<number> {
    const dayType = await this.getDayType(date, workCalendar);
    return dayType === 2 ? 7 : 8;
  }

  async calculatePaymentDate(
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

  async getLastWorkDayBefore(date: Date, workCalendar: Map<string, number>): Promise<Date> {
    let lastWorkDay = new Date(date);
    lastWorkDay.setDate(lastWorkDay.getDate() - 1);

    for (let i = 0; i < 30; i++) {
      if (await this.isWorkDay(lastWorkDay, workCalendar)) {
        return lastWorkDay;
      }
      lastWorkDay.setDate(lastWorkDay.getDate() - 1);
    }

    throw new Error("Could not find work day before vacation");
  }
}