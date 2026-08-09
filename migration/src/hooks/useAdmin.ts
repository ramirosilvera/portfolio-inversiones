import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { api, type AdminAccion } from '../lib/api';

// ¿El usuario logueado es admin? ¿está aprobado para operar en la app? Se resuelve server-side
// (Function + admin_users/usuarios_aprobados, sin RLS para el cliente — ver 0020/0021) — nunca un
// chequeo puramente local/spoofable. isAdmin solo gatea la UI (mostrar u ocultar el nav de Admin);
// isApproved gatea la app entera en App.tsx (con "cuenta pendiente" si no). La seguridad real está
// en que cada endpoint /api/admin/* re-verifica admin por su cuenta, y en que la policy
// portfolios_insert exige is_approved() en la base — esto nunca es la única barrera.
export function useEstadoCuenta(): { isAdmin: boolean; isApproved: boolean; isLoading: boolean; isError: boolean; reintentar: () => void } {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['admin-whoami', session?.user.id ?? 'anon'],
    enabled: !!session,
    staleTime: 5 * 60_000,
    retry: 2, // un cold-start de la Function o un hiccup de red no debe leerse como "no aprobado"
    queryFn: () => api.adminWhoAmI(),
  });
  // `isApproved: false` en el fallback de `??` no distinguía "confirmamos que no está aprobado" de
  // "no pudimos confirmar nada" — un usuario YA aprobado que entra con la red floja (o el primer
  // load en un dispositivo nuevo, sin caché) caía en PendingApprovalPage como si un admin todavía no
  // lo hubiera aprobado. `isError` deja que el caller (App.tsx) muestre un estado distinto.
  return { isAdmin: q.data?.isAdmin ?? false, isApproved: q.data?.isApproved ?? false, isLoading: q.isLoading, isError: q.isError, reintentar: () => void q.refetch() };
}

// enabled=false evita pedir /api/admin/users desde lugares que solo quieren mostrar el resumen si
// isAdmin ya dio true (ej. la tarjeta del Dashboard) — sin esto, cualquier usuario logueado
// dispararía el fetch en cada carga del Dashboard y recibiría un 403 de más (la Function igual lo
// re-verifica y lo rechaza; esto es solo para no hacer el pedido de arranque).
export function useAdminUsers(enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api.adminUsers(), enabled });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  return {
    users: q.data?.users ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    crear: async (body: { email: string; password: string; displayName?: string }) => {
      await api.adminCrearUsuario(body);
      invalidate();
    },
    accion: async (id: string, action: AdminAccion) => {
      await api.adminAccionUsuario(id, action);
      invalidate();
    },
    eliminar: async (id: string) => {
      await api.adminEliminarUsuario(id);
      invalidate();
    },
  };
}

export function useAdminAuditoria() {
  const q = useQuery({ queryKey: ['admin-audit'], queryFn: () => api.adminAuditoria() });
  return { entries: q.data?.entries ?? [], isLoading: q.isLoading };
}
