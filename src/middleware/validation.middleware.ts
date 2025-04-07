import { Request, Response, NextFunction } from "express";
import Joi from "joi";

const accountType = Joi.string()
  .valid('deposit', 'savings', 'investment', 'credit')
  .required()
  .messages({
    'any.only': 'Account type must be one of: deposit, savings, investment, credit',
    'any.required': 'Account type is required'
  });

const plan = Joi.number()
  .precision(2)
  .min(0)
  .default(0)
  .messages({
    'number.base': 'Plan must be a number',
    'number.min': 'Plan cannot be negative',
    'number.precision': 'Plan can have maximum 2 decimal places'
  });

const interestRate = Joi.number()
  .precision(2)
  .min(0)
  .max(100)
  .allow(null)
  .when('type', {
    is: Joi.not('deposit'),
    then: Joi.required(),
    otherwise: Joi.optional()
  })
  .messages({
    'number.base': 'Interest rate must be a number',
    'number.min': 'Interest rate cannot be negative',
    'number.max': 'Interest rate cannot exceed 100%',
    'number.precision': 'Interest rate can have maximum 2 decimal places',
    'any.required': 'Interest rate is required for non-deposit accounts'
  });

  const getBanksSchema = Joi.object({
    search: Joi.string()
      .min(1)
      .max(100)
      .trim()
      .optional()
      .description('Поисковая строка (по названию или БИКу банка)'),
      
    page: Joi.number()
      .integer()
      .min(1)
      .default(1)
      .optional()
      .description('Номер страницы (начиная с 1)'),
      
    pageSize: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20)
      .optional()
      .description('Количество элементов на странице (1-100)')
  }).options({
    stripUnknown: true, // удаляет неописанные поля
    abortEarly: false // возвращает все ошибки валидации, а не только первую
  });

// Схемы валидации для счетов
export const accountSchemas = {
  getBanks: getBanksSchema,
  createAccount: Joi.object({
    currency: Joi.string().length(3).required(),
    initialBalance: Joi.number().min(0).default(0),
    bank_bic: Joi.string().min(3).max(100).required(),
    account_name: Joi.string().min(3).max(100).required(),
    type: accountType,
    plan: plan,
    interest_rate: interestRate,
    is_salary: Joi.boolean()
      .default(false)
      .description('Является ли счет зарплатным')
  }),

  updateAccount: Joi.object({
    currency: Joi.string().length(3).required(),
    balance: Joi.number().min(0).default(0),
    bank_bic: Joi.string().min(3).max(100).required(),
    account_name: Joi.string().min(3).max(100).required(),
    type: Joi.string().valid('deposit', 'savings', 'investment', 'credit'),
    plan: plan,
    interest_rate: interestRate,
    is_salary: Joi.boolean().description('Является ли счет зарплатным')
  }).min(1),

  getAccounts: Joi.object({
    bank_bic: Joi.string().min(3).max(100),
    type: Joi.string().valid('deposit', 'savings', 'investment', 'credit')
  }),

  getTotalBalance: Joi.object({
    groupBy: Joi.string().valid('type', 'bank_bic')
  }),

  deleteAccount: Joi.object({
    accountId: Joi.string().pattern(/^\d+$/).required(),
  }),
};

// Схемы валидации для транзакций
export const transactionSchemas = {
  deposit: Joi.object({
    accountId: Joi.number().integer().positive().required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().max(255),
  }),

  withdrawal: Joi.object({
    accountId: Joi.number().integer().positive().required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().max(255),
  }),

  transfer: Joi.object({
    fromAccountId: Joi.number().integer().positive().required(),
    toAccountId: Joi.number().integer().positive().required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().max(255),
  }),

  history: Joi.object({
    accountId: Joi.number().integer().positive(),
    cursor: Joi.alternatives().try(Joi.string().isoDate(), Joi.number()),
    limit: Joi.number().integer().min(1).max(100).default(10),
    type: Joi.string()
      .valid(
        "deposit",
        "withdrawal",
        "transfer_out",
        "transfer_in"
      ),
    startDate: Joi.string().isoDate(),
    endDate: Joi.string().isoDate(),
    createdAt: Joi.string().isoDate(),
    sort: Joi.string()
      .pattern(/^-?(created_at|amount|type)$/)
      .default("-created_at"),
  }).with("endDate", "startDate"),

  deleteTransaction: Joi.object({
    transactionId: Joi.number().integer().positive().required(),
  }),
};

// Схемы валидации для транзакций
export const salarySchemas = {
  setSalary: Joi.object({
    amount: Joi.number().positive().required(),
    effective_from: Joi.string().isoDate(),
  }),

  calculateSalary: Joi.object({
    month: Joi.number().integer().positive().required(),
    year: Joi.number().positive().min(2000).required(),
  }),

  addVacation: Joi.object({
    startDate: Joi.string().isoDate(),
    endDate: Joi.string().isoDate(),
  }).with("endDate", "startDate")
};

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path[0],
        message: detail.message,
      }));
      res.status(400).json({ errors });
      return;
    }

    req.body = value;
    next();
  };
};

export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      allowUnknown: false,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path[0],
        message: detail.message,
      }));
      res.status(400).json({ errors });
    }

    req.query = value;
    next();
  };
};
