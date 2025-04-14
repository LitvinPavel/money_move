import { ISalary, IVacation, ISalaryCalculationResult, ISalaryPeriodCalculationResult } from "../../interfaces/salary.interface";
import { SalaryCalculatorService } from "./calculator.service";
import { DbService } from "./db.service";

export class SalaryService {
  private calculator = new SalaryCalculatorService();
  private dbService = new DbService();

  async calculateSalaryForMonth(
    userId: number,
    date: Date
  ): Promise<ISalaryCalculationResult> {
    return this.calculator.calculateSalaryForMonth(userId, date);
  }

  async calculateSalaryForPeriod(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<ISalaryPeriodCalculationResult> {
    return this.calculator.calculateSalaryForPeriod(userId, startDate, endDate);
  }

  async setSalary(
    userId: number,
    amount: number,
    effective_from: Date
  ): Promise<ISalary> {
    return this.dbService.setSalary(userId, amount, effective_from);
  }

  async addVacation(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<IVacation> {
    return this.dbService.addVacation(userId, startDate, endDate);
  }

  async deleteVacation(userId: number, vacationId: number): Promise<boolean> {
    return this.dbService.deleteVacation(userId, vacationId);
  }

  async getSalaryHistory(userId: number): Promise<ISalary[]> {
    return this.dbService.getSalaryHistory(userId);
  }

  async getVacations(
    userId: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<IVacation[]> {
    return this.dbService.getVacations(userId, startDate, endDate);
  }
}