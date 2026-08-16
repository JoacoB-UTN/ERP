'use client';

import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@erp/shared';
import { useForgotPassword } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordInput) {
    await forgotPassword.mutateAsync(values);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Recuperar contraseña</CardTitle>
        </CardHeader>
        <CardContent>
          {forgotPassword.isSuccess ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Si la cuenta existe, vas a recibir instrucciones para recuperar tu contraseña.
              </p>
              <Link href="/login" className="text-sm underline-offset-4 hover:underline">
                Volver a iniciar sesión
              </Link>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <Button type="submit" disabled={forgotPassword.isPending} className="mt-2">
                {forgotPassword.isPending ? 'Enviando…' : 'Enviar instrucciones'}
              </Button>
              <Link
                href="/login"
                className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Volver a iniciar sesión
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
