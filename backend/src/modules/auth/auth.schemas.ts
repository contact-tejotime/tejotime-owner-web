import { z } from 'zod';

export const loginSchema = z
  .object({
    phone: z.string().trim().min(1, 'Enter your phone number and password').max(20),
    password: z.string().min(1, 'Enter your phone number and password').max(128),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

export type LoginInput = z.infer<typeof loginSchema>;
