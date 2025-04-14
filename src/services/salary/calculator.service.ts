import { ISalary, IVacation, ISalaryCalculationResult, ISalaryPeriodCalculationResult } from "../../interfaces/salary.interface";
import { CalendarService } from "./calendar.service";
import { DbService } from "./db.service";
import pool from "../../db";

export class SalaryCalculatorService {
  private calendarService = new CalendarService();
  private dbService = new DbService();

  async calculateSalaryForPeriod(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<ISalaryPeriodCalculationResult> {
    try {
      // Валидация дат
      if (startDate > endDate) {
        throw new Error("Start date must be before end date");
      }
  
      // Получаем все месяцы в диапазоне
      const months = this.getMonthsInRange(startDate, endDate);
      
      // Вычисляем зарплату для каждого месяца
      const calculations = await Promise.all(
        months.map(month => this.calculateSalaryForMonth(userId, month))
      );
  
      // Вычисляем итоговые суммы с учетом дат выплат
      const totalAdvance = calculations.reduce((sum, calc) => {
        return calc.advance.paymentDate >= startDate && calc.advance.paymentDate <= endDate
          ? sum + calc.advance.amount
          : sum;
      }, 0);
  
      const totalSalary = calculations.reduce((sum, calc) => {
        return calc.salary.paymentDate >= startDate && calc.salary.paymentDate <= endDate
          ? sum + calc.salary.amount
          : sum;
      }, 0);
  
      const totalVacationPay = calculations.reduce((sum, calc) => {
        if (!calc.vacationPay) return sum;
        return calc.vacationPay.paymentDate >= startDate && calc.vacationPay.paymentDate <= endDate
          ? sum + calc.vacationPay.amount
          : sum;
      }, 0);
  
      // Фильтруем расчеты, оставляя только те, где хотя бы одна выплата попадает в период
      const filteredCalculations = calculations.filter(calc => {
        const advanceInRange = calc.advance.paymentDate >= startDate && 
                              calc.advance.paymentDate <= endDate;
        const salaryInRange = calc.salary.paymentDate >= startDate && 
                            calc.salary.paymentDate <= endDate;
        const vacationInRange = calc.vacationPay 
                              ? calc.vacationPay.paymentDate >= startDate && 
                                calc.vacationPay.paymentDate <= endDate
                              : false;
        
        return advanceInRange || salaryInRange || vacationInRange;
      });
  
      return {
        periodStart: startDate,
        periodEnd: endDate,
        calculations: filteredCalculations,
        total: {
          advance: totalAdvance,
          salary: totalSalary,
          vacationPay: totalVacationPay,
          overall: totalAdvance + totalSalary + totalVacationPay
        }
      };
    } catch (error) {
      console.error("Period calculation failed:", error);
      throw new Error(`Salary period calculation failed: ${error}`);
    }
  }

  private getMonthsInRange(startDate: Date, endDate: Date): Date[] {
    const months: Date[] = [];
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    
    while (current <= endDate) {
      months.push(new Date(current));
      current.setMonth(current.getMonth() + 1);
    }
    
    return months;
  }

  async calculateSalaryForMonth(
    userId: number,
    date: Date
  ): Promise<ISalaryCalculationResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

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

  private async calculateSalary(
    userId: number,
    date: Date
  ): Promise<ISalaryCalculationResult> {
    const [currentSalary, workCalendar, vacations, prevVacations] = await Promise.all([
      this.dbService.getCurrentSalary(userId, date),
      this.calendarService.getWorkCalendar(date),
      this.dbService.getUserVacations(userId, date),
      this.dbService.getUserVacations(userId, new Date(date.getFullYear(), date.getMonth() - 1, 1)),
    ]);

    const { advanceHours, salaryHours, vacationDays } = await this.calculateWorkHours(
      date,
      workCalendar,
      vacations,
      prevVacations
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
      const firstVacationDay = vacations.reduce((earliest: IVacation, vacation: IVacation) => 
        vacation.start_date < earliest.start_date ? vacation : earliest
      ).start_date;

      const paymentDate = await this.calendarService.getLastWorkDayBefore(firstVacationDay, workCalendar);
      vacationPay = {
        amount: vacationDays * 8 * averageHourlyRate,
        days: vacationDays,
        averageHourlyRate,
        paymentDate
      };
    }

    const [advancePaymentDate, salaryPaymentDate] = await Promise.all([
      this.calendarService.calculatePaymentDate(date, 27, workCalendar),
      this.calendarService.calculatePaymentDate(date, 12, workCalendar),
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

  private async calculateWorkHours(
    date: Date,
    workCalendar: Map<string, number>,
    vacations: IVacation[],
    prevVacations: IVacation[]
  ): Promise<{ advanceHours: number; salaryHours: number; vacationDays: number }> {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const midMonth = new Date(date.getFullYear(), date.getMonth(), 15);

    let advanceHours = 0;
    let salaryHours = 0;
    let vacationDays = 0;

    // Текущий месяц (аванс)
    for (let day = new Date(monthStart); day <= monthEnd; day.setDate(day.getDate() + 1)) {
      const _isWorkDay = await this.calendarService.isWorkDay(day, workCalendar);
      const isVacationDay = vacations.some(v => day >= v.start_date && day <= v.end_date);
      if (_isWorkDay) {
        if (isVacationDay) {
          vacationDays++;
          continue;
        }
        if (day <= midMonth) {
          advanceHours += await this.calendarService.getDailyWorkHours(day, workCalendar);
        }
      }
    }

    // Предыдущий месяц (зарплата)
    const prevMonthStart = new Date(date.getFullYear(), date.getMonth() - 1, 16);
    const prevMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0);

    for (let day = new Date(prevMonthStart); day <= prevMonthEnd; day.setDate(day.getDate() + 1)) {
      const isVacationDay = prevVacations.some(v => day >= v.start_date && day <= v.end_date);
      if (isVacationDay) {
        continue;
      }

      if (await this.calendarService.isWorkDay(day, workCalendar)) {
        salaryHours += await this.calendarService.getDailyWorkHours(day, workCalendar);
      }
    }

    return { advanceHours, salaryHours, vacationDays };
  }

  private async calculateStandardWorkHours(
    date: Date,
    workCalendar: Map<string, number>
  ): Promise<number> {
    let totalHours = 0;
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    for (let day = new Date(monthStart); day <= monthEnd; day.setDate(day.getDate() + 1)) {
      const dayType = await this.calendarService.getDayType(day, workCalendar);
      if (dayType === 0) totalHours += 8;
      else if (dayType === 2) totalHours += 7;
    }
    
    return totalHours;
  }

  private async calculateAverageHourlyRate(
    userId: number,
    date: Date
  ): Promise<number> {
    const threeMonthsAgo = new Date(date.getFullYear(), date.getMonth() - 3, 1);
    const lastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 0);
  
    const salariesResult = await pool.query<ISalary>(
      `SELECT * FROM salaries 
       WHERE user_id = $1 AND effective_from <= $2
       ORDER BY effective_from DESC`,
      [userId, lastMonth]
    );
  
    if (salariesResult.rows.length === 0) {
      throw new Error("No salary data available for the user");
    }
  
    const latestSalary = salariesResult.rows[0];
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
  
      const salary = salariesResult.rows.find(
        (s: { effective_from: Date | string }) => new Date(s.effective_from) <= monthEnd
      );
      const { base_salary } = salary || latestSalary;
      if (!base_salary) continue;
      
      const workCalendar = await this.calendarService.getWorkCalendar(monthStart);
      let monthHours = 0;
  
      for (
        let day = new Date(monthStart);
        day <= monthEnd;
        day.setDate(day.getDate() + 1)
      ) {
        if (await this.calendarService.isWorkDay(day, workCalendar)) {
          monthHours += await this.calendarService.getDailyWorkHours(day, workCalendar);
        }
      }
      if (monthHours > 0) {
        totalEarnings += +base_salary;
        totalHours += monthHours;
      }
    }
  
    if (totalHours === 0) {
      throw new Error("No work hours found for last 3 months");
    }

    return totalEarnings / totalHours;
  }
}