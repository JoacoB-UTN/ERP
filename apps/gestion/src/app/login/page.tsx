'use client';

import { useState, type BaseSyntheticEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowBigUp, ArrowRight, Check, CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { loginSchema, type LoginInput } from '@erp/shared';
import { ApiError } from '@erp/auth-client';
import { useLogin } from '@/lib/auth-client';
import { LoginWeave } from '@/components/auth/login-weave';
import { LogoMark } from '@/components/brand/logo-mark';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const passwordField = register('password');

  // Restarting a CSS animation needs the class removed, a reflow, and the
  // class added back; toggling it through state would batch into a no-op.
  function shake(event?: BaseSyntheticEvent) {
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    form.classList.remove('login-shake');
    void form.offsetWidth;
    form.classList.add('login-shake');
  }

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState('CapsLock'));
  }

  async function onSubmit(values: LoginInput, event?: BaseSyntheticEvent) {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      setSignedIn(true);
      // Always the picker, never a workspace directly: which modules this user
      // has is a permission question the picker already answers, and it sends
      // them straight through when there is only one. See app/modulos/page.tsx.
      router.push('/modulos');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo iniciar sesión.');
      shake(event);
    }
  }

  const busy = login.isPending || signedIn;

  return (
    <main className="relative grid min-h-screen grid-rows-[auto_1fr] bg-background lg:grid-cols-[5fr_6fr] lg:grid-rows-none">
      {/* Brand panel: the logotype signs itself in over threads that part
          around the pointer. The only decorative surface on the screen; the
          form side stays plain. */}
      <aside className="relative isolate flex min-h-[220px] flex-col justify-center overflow-hidden border-b bg-[radial-gradient(120%_90%_at_0%_100%,var(--accent),var(--card))] px-6 py-8 lg:border-r lg:border-b-0 lg:px-12 lg:py-10">
        <LoginWeave />
        <LogoMark className="login-sign w-[200px] lg:w-[min(360px,78%)]" />
        <p className="absolute bottom-10 left-12 hidden text-xs text-muted-foreground lg:block">
          © Todos los derechos reservados
        </p>
      </aside>

      <ThemeToggle className="absolute top-4 right-4" />

      <div className="flex justify-center px-4 pt-10 pb-12 lg:items-center lg:px-6 lg:py-12">
        <div className="w-full max-w-[380px] animate-in duration-700 ease-out fade-in slide-in-from-bottom-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground">
            Iniciá sesión
          </h1>
          <p className="mt-2.5 text-[0.9375rem] text-muted-foreground">Ingresá con tu email y contraseña.</p>

          <form
            className="mt-9 flex flex-col gap-5"
            onSubmit={handleSubmit(onSubmit, (_errors, event) => shake(event))}
            noValidate
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Ingresá tu email"
                className="h-11 rounded-lg px-3.5"
                {...register('email')}
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <p className="animate-in text-sm text-destructive fade-in slide-in-from-top-1">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <Link
                  href="/forgot-password"
                  className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0_1px] bg-left-bottom bg-no-repeat text-[0.8125rem] font-medium text-primary transition-[background-size] duration-300 ease-out hover:bg-[length:100%_1px]"
                >
                  Olvidé mi contraseña
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Ingresá tu contraseña"
                  className="h-11 rounded-lg px-3.5 pr-11"
                  {...passwordField}
                  onKeyDown={trackCapsLock}
                  onKeyUp={trackCapsLock}
                  onBlur={(event) => {
                    setCapsLock(false);
                    return passwordField.onBlur(event);
                  }}
                  aria-invalid={!!errors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  // Not a Button: this sits inside the field as an affordance of
                  // the input itself, not as an action of the form.
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                >
                  <Eye
                    className={cn(
                      'col-start-1 row-start-1 size-[1.125rem] transition-[opacity,transform] duration-300 ease-out',
                      showPassword && 'scale-60 rotate-20 opacity-0',
                    )}
                  />
                  <EyeOff
                    className={cn(
                      'col-start-1 row-start-1 size-[1.125rem] transition-[opacity,transform] duration-300 ease-out',
                      !showPassword && 'scale-60 -rotate-20 opacity-0',
                    )}
                  />
                </button>
              </div>
              {errors.password && (
                <p className="animate-in text-sm text-destructive fade-in slide-in-from-top-1">
                  {errors.password.message}
                </p>
              )}
              {capsLock && (
                <p className="flex animate-in items-center gap-1.5 text-sm text-warning fade-in slide-in-from-top-1">
                  <ArrowBigUp className="size-3.5" aria-hidden="true" />
                  Bloq Mayús está activado
                </p>
              )}
            </div>

            {formError && (
              <p
                role="alert"
                className="flex animate-in items-start gap-2.5 rounded-lg bg-destructive-muted px-3.5 py-3 text-sm text-destructive fade-in slide-in-from-top-1"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {formError}
              </p>
            )}

            <Button
              type="submit"
              disabled={busy}
              className={cn(
                'mt-1 h-12 w-full gap-2.5 rounded-lg text-[0.9375rem] disabled:opacity-100',
                signedIn && 'bg-success hover:bg-success',
              )}
            >
              {signedIn ? 'Listo' : login.isPending ? 'Ingresando…' : 'Ingresar'}
              {signedIn ? (
                <Check className="size-[1.125rem] animate-in zoom-in-50" aria-hidden="true" />
              ) : login.isPending ? (
                <LoaderCircle className="size-[1.125rem] animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight
                  className="size-[1.125rem] transition-transform duration-300 ease-out group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              )}
            </Button>
          </form>

          <p className="mt-10 text-[0.8125rem] text-muted-foreground">
            ¿No tenés cuenta? Pedísela al administrador del sistema.
          </p>
        </div>
      </div>
    </main>
  );
}
