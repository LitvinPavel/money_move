import { Request, Response, NextFunction } from "express";
import Joi from "joi";

// Схемы валидации для счетов
export const accountSchemas = {
  createAccount: Joi.object({
    currency: Joi.string().length(3).required(),
    initialBalance: Joi.number().min(0).default(0),
    bank_name: Joi.string().min(3).max(100).required(),
    account_name: Joi.string().min(3).max(100).required()
  }),

  updateAccount: Joi.object({
    currency: Joi.string().length(3).required(),
    balance: Joi.number().min(0).default(0),
    bank_name: Joi.string().min(3).max(100).required(),
    account_name: Joi.string().min(3).max(100).required()
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
    type: Joi.string().valid(
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
