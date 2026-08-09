import { z } from 'zod';

export const loginSchema = z
  .object({
    phone: z.string().trim().min(1, 'Enter your phone number and password').max(20),
    password: z.string().min(1, 'Enter your phone number and password').max(128),
    // Which side of the sign-in screen the user picked. Optional so the Expo app, which has
    // no such control, keeps working unchanged.
    accountType: z.enum(['owner', 'staff']).optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: z.string().min(8, 'Use at least 8 characters').max(128),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

export type LoginInput = z.infer<typeof loginSchema>;
