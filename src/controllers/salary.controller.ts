import { Request, Response } from 'express';
import { SalaryService } from '../services/salary.service';

export class SalaryController {
  private salaryService: SalaryService;

  constructor() {
    this.salaryService = new SalaryService();
  }

  public setSalary = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const { amount, effective_from } = req.body;

      const salary = await this.salaryService.setSalary(
        userId, 
        amount, 
        new Date(effective_from)
      );

      res.status(201).json(salary);
    } catch (error) {
      console.error('Set salary error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to set salary'
      });
    }
  }

  public calculateSalary = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);

      const result = await this.salaryService.calculateSalaryForMonth(
        userId,
        new Date(year, month - 1, 1)
      );

      res.json(result);
    } catch (error) {
      console.error('Calculate salary error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to calculate salary'
      });
    }
  }

  public addVacation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const { startDate, endDate } = req.body;

      const vacation = await this.salaryService.addVacation(
        userId,
        new Date(startDate),
        new Date(endDate)
      );

      res.status(201).json(vacation);
    } catch (error) {
      console.error('Add vacation error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to add vacation'
      });
    }
  }

  public getSalaryHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const history = await this.salaryService.getSalaryHistory(userId);
      res.json(history);
    } catch (error) {
      console.error('Get salary history error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to get salary history'
      });
    }
  }

  public getVacations = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const { startDate, endDate } = req.query;

      const vacations = await this.salaryService.getVacations(
        userId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json(vacations);
    } catch (error) {
      console.error('Get vacations error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to get vacations'
      });
    }
  }

  public deleteVacation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new Error('Unauthorized');
      const vacationId = parseInt(req.params.id);

      const isDeleted = await this.salaryService.deleteVacation(userId, vacationId);
      
      if (!isDeleted) {
        res.status(404).json({ message: 'Vacation not found' });
        return;
      }

      res.json({ message: 'Vacation deleted successfully' });
    } catch (error) {
      console.error('Delete vacation error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to delete vacation'
      });
    }
  }
}