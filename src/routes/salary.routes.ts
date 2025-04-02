import { SalaryController } from "../controllers/salary.controller";
import express, { Router } from "express";
import {
  salarySchemas,
  validate,
  validateQuery,
} from "../middleware/validation.middleware";
import { authMiddleware } from "../middleware/auth.middleware";

const router: Router = express.Router();
const salaryController = new SalaryController();

router.use(authMiddleware);

router.post("/", validate(salarySchemas.setSalary), salaryController.setSalary);

router.get("/calculate", validateQuery(salarySchemas.calculateSalary), salaryController.calculateSalary);

router.post("/vacations", validate(salarySchemas.addVacation), salaryController.addVacation);

router.get("/history", salaryController.getSalaryHistory);

router.get("/vacations", salaryController.getVacations);

router.delete("/vacations/:id", salaryController.deleteVacation);

export default router;
