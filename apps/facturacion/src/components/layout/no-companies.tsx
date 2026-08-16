export function NoCompanies() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-medium">No tenés empresas habilitadas para operar.</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        Pedile a un administrador que te dé acceso a una empresa para poder continuar.
      </p>
    </div>
  );
}
