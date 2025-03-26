import Joi from "joi";

export const authSchema = Joi.object({
  name: Joi.string().min(2).max(50).when("$isRegister", {
    is: true,
    then: Joi.required(),
  }),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  confirmPassword: Joi.string().valid(Joi.ref("password")).when("$isRegister", {
    is: true,
    then: Joi.required(),
  }),
});

export const validateRequest = (data: any, isRegister = false) => {
  return authSchema.validate(data, {
    abortEarly: false,
    context: { isRegister },
  });
};
