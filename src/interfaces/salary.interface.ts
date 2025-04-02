export interface ISalary {
    id: number;
    userId: number;
    base_salary: number;
    effective_from: Date;
    createdAt: Date;
  }
  
  export interface IVacation {
    id: number;
    userId: number;
    start_date: Date;
    end_date: Date;
    createdAt: Date;
  }
  
  export interface IWorkDay {
    id: number;
    userId: number;
    date: Date;
    hours: number;
    isHoliday: boolean;
    isVacation: boolean;
  }
  
  export interface IHoliday {
    id?: number;
    date: Date;
    name: string;
    country: string;
    year: number;
    is_short_day: boolean;
  }
  
  export interface ISalaryCalculationResult {
    advance: {
      amount: number;
      paymentDate: Date;
      hours: number;
      hourlyRate: number;
    };
    salary: {
      amount: number;
      paymentDate: Date;
      hours: number;
      hourlyRate: number;
    };
    vacationPay?: {
      amount: number;
      days: number;
      averageHourlyRate: number;
      paymentDate: Date;
    };
    total: number;
  }