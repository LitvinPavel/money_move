import { Request, Response, NextFunction } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { ValidationError } from "joi";

// Кастомный интерфейс для ошибок
interface AppError extends Error {
  statusCode?: number;
  errors?: Record<string, string>;
  details?: any;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Установка стандартного статуса ошибки
  const statusCode = err.statusCode || 500;

  // Обработка различных типов ошибок
  if (err instanceof ValidationError) {
    // Ошибки валидации Joi
    const errors: Record<string, string> = {};
    err.details.forEach((detail) => {
      const key = detail.path.join(".");
      errors[key] = detail.message;
    });

    res.status(400).json({
      success: false,
      message: "Validation error",
      errors,
    });
  }

  if (err instanceof JsonWebTokenError || err instanceof TokenExpiredError) {
    // Ошибки JWT
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      error: err.message,
    });
    return;
  }

  // Стандартная обработка ошибок
  res.status(statusCode).json({
    success: false,
    message: err.message,
    error: process.env.NODE_ENV === "development" ? err.stack : {},
  });
};

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error: AppError = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};
