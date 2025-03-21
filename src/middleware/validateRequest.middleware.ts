import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export const validateRequest = (schema: Joi.ObjectSchema, source: 'body' | 'cookies' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    let dataToValidate;

    if (source === 'body') {
      dataToValidate = req.body;
    } else if (source === 'cookies') {
      dataToValidate = req.cookies;
    }

    const { error } = schema.validate(dataToValidate, { abortEarly: false });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      res.status(400).json({ message: 'Validation failed', errors });
      return;
    }

    next();
  };
};