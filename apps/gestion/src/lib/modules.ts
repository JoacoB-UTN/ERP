import { FacturacionIcon, GestionIcon } from '@/components/brand/module-icons';

import { FACTURACION_URL } from './api';

/**
 * The workspaces a user can be sent to after logging in.
 *
 * Deliberately two, not three: POS is a mode of Facturación, not a separate
 * application (product-ui-principles.md), and the workspace switcher already
 * encodes that same "exactly two entries" rule. Gating POS separately is a
 * permission concern inside Facturación, not a third tile here.
 *
 * `permission` mirrors what each app's own layout already enforces, and the
 * backend enforces independently — this list decides what to OFFER, never what
 * is allowed.
 */
export type WorkspaceModule = {
  id: 'gestion' | 'facturacion';
  name: string;
  description: string;
  permission: 'apps.gestion.access' | 'apps.facturacion.access';
  /** Absolute for the sibling workspace, relative for this app's own. */
  href: string;
  isCurrentApp: boolean;
  icon: (props: { className?: string }) => React.JSX.Element;
  /** Tailwind background for the 32px icon tile — one identity per module. */
  tileClassName: string;
};

export function workspaceModules(): WorkspaceModule[] {
  return [
    {
      id: 'gestion',
      name: 'Gestión',
      description: 'Clientes, productos, stock, precios, compras y administración.',
      permission: 'apps.gestion.access',
      href: '/',
      isCurrentApp: true,
      icon: GestionIcon,
      tileClassName: 'bg-chart-1',
    },
    {
      id: 'facturacion',
      name: 'Facturación',
      description: 'Ventas rápidas, punto de venta y consulta de precios y stock.',
      permission: 'apps.facturacion.access',
      href: FACTURACION_URL,
      isCurrentApp: false,
      icon: FacturacionIcon,
      tileClassName: 'bg-chart-3',
    },
  ];
}
